/**
 * Google Apps Script web app that sends ticket and receipt emails, mirrors
 * every delivery attempt into the bound Google Sheet, and syncs the booking
 * list into the "Bookings" tab.
 *
 * Deploy this file inside the Sheet (Extensions -> Apps Script), then publish
 * it as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Setup, including the SHARED_SECRET script property, is documented in
 * apps-script/README.md. The backend calls it from
 * backend/services/appsScriptWebhookClientService.js.
 *
 * GmailApp is used instead of MailApp because GmailApp supports the same
 * attachments and HTML body while matching the working confirmation-email
 * setup used by the event team. Run sendTestEmailToScriptOwner once after
 * pasting this file to grant the Gmail permission.
 *
 * The script never trusts the caller's metadata for anything security-related:
 * the recipient and attachments come from the request body, the shared secret is
 * compared in constant time, and a repeated delivery key never sends twice.
 */

var DELIVERY_SHEET_NAME = 'Ticket deliveries';
var DELIVERY_SHEET_HEADERS = [
  'Delivery key',
  'Email kind',
  'Booking reference',
  'Attendee name',
  'Email address',
  'Phone number',
  'Booking status',
  'Event',
  'Event date',
  'Event time',
  'Venue',
  'Ticket type',
  'Amount',
  'Currency',
  'Delivery status',
  'Delivery id',
  'Error',
  'Attempt count',
  'First attempted at',
  'Last attempted at',
];

var BOOKING_MIRROR_SHEET_NAME = 'Bookings';
var BOOKING_MIRROR_SHEET_HEADERS = [
  'Booking reference',
  'Attendee name',
  'Email address',
  'Phone number',
  'Booking status',
  'Payment status',
  'Payment method',
  'Amount',
  'Currency',
  'Referral',
  'Ticket sent at',
  'Booking created at',
  'Last synced at',
];

var MAXIMUM_REQUEST_BYTES = 12 * 1024 * 1024;
var MAXIMUM_ATTACHMENT_BYTES = 8 * 1024 * 1024;
var MAXIMUM_BOOKINGS_PER_SYNC_REQUEST = 500;
var MAXIMUM_ERROR_LENGTH = 500;
var LOCK_WAIT_MILLISECONDS = 30000;
var DELIVERY_LEASE_MILLISECONDS = 15 * 60 * 1000;
var EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

var SAFE_ERROR_CODES = {
  invalid_request: true,
  request_too_large: true,
  unauthorized: true,
  apps_script_secret_not_configured: true,
  spreadsheet_not_available: true,
  delivery_metadata_missing: true,
  unsupported_email_kind: true,
  invalid_recipient: true,
  invalid_attachment: true,
  attachment_too_large: true,
  mail_send_failed: true,
  gmail_quota_check_failed: true,
  daily_quota_exhausted: true,
  delivery_in_progress: true,
  script_busy: true,
  booking_batch_too_large: true,
  booking_reference_missing: true,
};

// A public GET is a deployment health check, not a data endpoint. It lets an
// operator confirm in an incognito window that the /exec URL is anonymous and
// that the new script version is live before retrying a ticket resend.
function doGet() {
  return buildJsonResponse({
    ok: true,
    service: 'ticket-email-and-sheet-sync',
    supportsBookingSync: true,
  });
}

function doPost(requestEvent) {
  var scriptLock = LockService.getScriptLock();

  try {
    if (!scriptLock.tryLock(LOCK_WAIT_MILLISECONDS)) {
      return buildJsonResponse({ ok: false, error: 'script_busy' });
    }

    var expectedSharedSecret = PropertiesService.getScriptProperties().getProperty(
      'SHARED_SECRET'
    );

    if (!expectedSharedSecret) {
      return buildJsonResponse({
        ok: false,
        error: 'apps_script_secret_not_configured',
      });
    }

    var requestBody = parseJsonRequestBody(requestEvent);
    if (!secretsMatch(requestBody.sharedSecret, expectedSharedSecret)) {
      return buildJsonResponse({ ok: false, error: 'unauthorized' });
    }

    if (requestBody.requestType === 'sync_bookings') {
      return handleBookingSyncRequest(requestBody);
    }

    return handleEmailDeliveryRequest(requestBody);
  } catch (error) {
    return buildJsonResponse({ ok: false, error: readSafeErrorCode(error) });
  } finally {
    if (scriptLock.hasLock()) {
      scriptLock.releaseLock();
    }
  }
}

function handleEmailDeliveryRequest(requestBody) {
  var emailRequest = validateEmailRequest(requestBody.emailRequest);
  var deliverySheet = getOrCreateDeliverySheet();
  var existingDeliveryRow = findDeliveryRow(deliverySheet, emailRequest.deliveryKey);

  if (existingDeliveryRow && existingDeliveryRow['Delivery status'] === 'sent') {
    return buildJsonResponse({
      ok: true,
      duplicate: true,
      deliveryId: existingDeliveryRow['Delivery id'],
      remainingDailyQuota: readRemainingDailyQuotaOrNull(),
    });
  }

  // A "sending" row means an earlier execution reserved the key and then died
  // before it could report the outcome. Sending again immediately could email
  // the attendee twice, so the lease must expire first.
  if (
    existingDeliveryRow &&
    existingDeliveryRow['Delivery status'] === 'sending' &&
    isDeliveryLeaseActive(existingDeliveryRow['Last attempted at'])
  ) {
    return buildJsonResponse({ ok: false, error: 'delivery_in_progress' });
  }

  if (readRemainingDailyQuota() <= 0) {
    upsertDeliveryRow(deliverySheet, existingDeliveryRow, emailRequest, {
      deliveryStatus: 'failed',
      deliveryId: '',
      errorMessage: 'daily_quota_exhausted',
    }, 1);

    return buildJsonResponse({ ok: false, error: 'daily_quota_exhausted' });
  }

  var deliveryId = Utilities.getUuid();

  // Reserve the key before sending. If the process dies after Gmail accepts
  // the message, the row stays "sending" and the lease prevents a duplicate.
  upsertDeliveryRow(deliverySheet, existingDeliveryRow, emailRequest, {
    deliveryStatus: 'sending',
    deliveryId: deliveryId,
    errorMessage: '',
  }, 1);

  var reservedDeliveryRow = findDeliveryRow(deliverySheet, emailRequest.deliveryKey);

  try {
    var mailOptions = {
      htmlBody: emailRequest.emailHtmlBody,
      name: emailRequest.senderDisplayName,
      attachments: buildMailAttachments(emailRequest.attachments),
    };

    // An empty replyTo is rejected by GmailApp, so only add it when the backend
    // supplied a valid fallback address.
    if (emailRequest.replyToEmailAddress) {
      mailOptions.replyTo = emailRequest.replyToEmailAddress;
    }

    GmailApp.sendEmail(
      emailRequest.recipientEmailAddress,
      emailRequest.emailSubject,
      emailRequest.emailTextBody,
      mailOptions
    );
  } catch (mailError) {
    var mailErrorMessage = truncateErrorMessage(mailError && mailError.message);
    console.error('mail_send_failed: ' + mailErrorMessage);

    upsertDeliveryRow(deliverySheet, reservedDeliveryRow, emailRequest, {
      deliveryStatus: 'failed',
      deliveryId: deliveryId,
      errorMessage: mailErrorMessage,
    }, 0);

    return buildJsonResponse({
      ok: false,
      error: 'mail_send_failed',
      mailErrorMessage: mailErrorMessage,
    });
  }

  upsertDeliveryRow(deliverySheet, reservedDeliveryRow, emailRequest, {
    deliveryStatus: 'sent',
    deliveryId: deliveryId,
    errorMessage: '',
  }, 0);

  return buildJsonResponse({
    ok: true,
    deliveryId: deliveryId,
    remainingDailyQuota: readRemainingDailyQuotaOrNull(),
  });
}

function handleBookingSyncRequest(requestBody) {
  var bookings = requestBody.bookings;

  if (!Array.isArray(bookings)) {
    throw new Error('invalid_request');
  }

  if (bookings.length > MAXIMUM_BOOKINGS_PER_SYNC_REQUEST) {
    throw new Error('booking_batch_too_large');
  }

  var bookingMirrorSheet = getOrCreateBookingMirrorSheet();
  var syncSummary = upsertBookingMirrorRows(
    bookingMirrorSheet,
    bookings,
    requestBody.syncedAt || formatTimestamp(new Date())
  );

  return buildJsonResponse({
    ok: true,
    requestType: 'sync_bookings',
    syncedCount: syncSummary.syncedCount,
    createdCount: syncSummary.createdCount,
    updatedCount: syncSummary.updatedCount,
  });
}

function upsertBookingMirrorRows(bookingMirrorSheet, bookings, syncedAt) {
  var existingRows = readSheetRowsByHeader(
    bookingMirrorSheet,
    BOOKING_MIRROR_SHEET_HEADERS
  );
  var rowIndexByBookingReference = {};

  existingRows.forEach(function (existingRow, rowIndex) {
    var existingBookingReference = String(
      existingRow['Booking reference'] || ''
    );
    if (existingBookingReference) {
      rowIndexByBookingReference[existingBookingReference] = rowIndex;
    }
  });

  var createdCount = 0;
  var updatedCount = 0;

  bookings.forEach(function (booking) {
    var bookingReference = String(booking.bookingReference || '').trim();
    if (!bookingReference) {
      throw new Error('booking_reference_missing');
    }

    var bookingRowValues = buildBookingMirrorRowValues(booking, syncedAt);
    var existingRowIndex = rowIndexByBookingReference[bookingReference];

    if (typeof existingRowIndex === 'number') {
      existingRows[existingRowIndex] = bookingRowValues;
      updatedCount += 1;
      return;
    }

    rowIndexByBookingReference[bookingReference] = existingRows.length;
    existingRows.push(bookingRowValues);
    createdCount += 1;
  });

  if (existingRows.length > 0) {
    bookingMirrorSheet
      .getRange(2, 1, existingRows.length, BOOKING_MIRROR_SHEET_HEADERS.length)
      .setValues(existingRows);
  }

  return {
    syncedCount: createdCount + updatedCount,
    createdCount: createdCount,
    updatedCount: updatedCount,
  };
}

function buildBookingMirrorRowValues(booking, syncedAt) {
  var valuesByHeader = {
    'Booking reference': String(booking.bookingReference || ''),
    'Attendee name': String(booking.attendeeName || ''),
    'Email address': String(booking.emailAddress || ''),
    'Phone number': String(booking.phoneNumber || ''),
    'Booking status': String(booking.bookingStatus || ''),
    'Payment status': String(booking.paymentStatus || ''),
    'Payment method': String(booking.paymentMethod || ''),
    Amount: booking.paymentAmount == null ? '' : booking.paymentAmount,
    Currency: String(booking.paymentCurrency || ''),
    Referral: String(booking.referrerName || ''),
    'Ticket sent at': String(booking.ticketSentAt || ''),
    'Booking created at': String(booking.bookingCreatedAt || ''),
    'Last synced at': String(syncedAt || ''),
  };

  return BOOKING_MIRROR_SHEET_HEADERS.map(function (headerLabel) {
    return valuesByHeader[headerLabel];
  });
}

function parseJsonRequestBody(requestEvent) {
  if (!requestEvent || !requestEvent.postData || !requestEvent.postData.contents) {
    throw new Error('invalid_request');
  }

  if (requestEvent.postData.contents.length > MAXIMUM_REQUEST_BYTES) {
    throw new Error('request_too_large');
  }

  try {
    return JSON.parse(requestEvent.postData.contents);
  } catch (parseError) {
    throw new Error('invalid_request');
  }
}

function secretsMatch(providedSecret, expectedSecret) {
  if (typeof providedSecret !== 'string' || typeof expectedSecret !== 'string') {
    return false;
  }

  if (providedSecret.length !== expectedSecret.length) {
    return false;
  }

  var difference = 0;
  for (var characterIndex = 0; characterIndex < expectedSecret.length; characterIndex += 1) {
    difference |=
      providedSecret.charCodeAt(characterIndex) ^
      expectedSecret.charCodeAt(characterIndex);
  }

  return difference === 0;
}

function validateEmailRequest(emailRequest) {
  if (!emailRequest || typeof emailRequest !== 'object') {
    throw new Error('invalid_request');
  }

  if (!emailRequest.deliveryKey || !emailRequest.emailKind) {
    throw new Error('delivery_metadata_missing');
  }

  if (emailRequest.emailKind !== 'ticket' && emailRequest.emailKind !== 'receipt') {
    throw new Error('unsupported_email_kind');
  }

  var recipientEmailAddress = String(emailRequest.recipientEmailAddress || '').trim();
  if (!EMAIL_ADDRESS_PATTERN.test(recipientEmailAddress)) {
    throw new Error('invalid_recipient');
  }

  if (!emailRequest.emailSubject && !emailRequest.emailHtmlBody) {
    throw new Error('invalid_request');
  }

  var attachments = emailRequest.attachments || [];
  if (!Array.isArray(attachments)) {
    throw new Error('invalid_attachment');
  }

  attachments.forEach(validateAttachment);

  return {
    deliveryKey: String(emailRequest.deliveryKey),
    emailKind: emailRequest.emailKind,
    recipientEmailAddress: recipientEmailAddress,
    emailSubject: String(emailRequest.emailSubject || ''),
    emailTextBody: String(emailRequest.emailTextBody || ''),
    emailHtmlBody: String(emailRequest.emailHtmlBody || ''),
    senderDisplayName: String(emailRequest.senderDisplayName || ''),
    replyToEmailAddress: String(emailRequest.replyToEmailAddress || ''),
    attachments: attachments,
    booking: emailRequest.booking || {},
    event: emailRequest.event || {},
    ticket: emailRequest.ticket || {},
  };
}

function validateAttachment(attachment) {
  if (
    !attachment ||
    typeof attachment.base64Content !== 'string' ||
    !attachment.base64Content ||
    !attachment.fileName
  ) {
    throw new Error('invalid_attachment');
  }

  var decodedSizeBytes = estimateBase64SizeBytes(attachment.base64Content);
  if (decodedSizeBytes > MAXIMUM_ATTACHMENT_BYTES) {
    throw new Error('attachment_too_large');
  }
}

function estimateBase64SizeBytes(base64Content) {
  var paddingLength = base64Content.endsWith('==')
    ? 2
    : base64Content.endsWith('=')
      ? 1
      : 0;

  return Math.floor((base64Content.length * 3) / 4) - paddingLength;
}

function buildMailAttachments(attachments) {
  return attachments.map(function (attachment) {
    var decodedBytes;

    try {
      decodedBytes = Utilities.base64Decode(attachment.base64Content);
    } catch (decodeError) {
      throw new Error('invalid_attachment');
    }

    if (decodedBytes.length > MAXIMUM_ATTACHMENT_BYTES) {
      throw new Error('attachment_too_large');
    }

    return Utilities.newBlob(
      decodedBytes,
      String(attachment.mimeType || 'application/octet-stream'),
      String(attachment.fileName)
    );
  });
}

function readRemainingDailyQuota() {
  try {
    return GmailApp.getRemainingDailyQuota();
  } catch (quotaError) {
    console.error('gmail_quota_check_failed: ' + quotaError.message);
    throw new Error('gmail_quota_check_failed');
  }
}

// After a successful send, a quota-read failure must not turn a delivered
// message into a reported failure. The quota field is optional for the backend.
function readRemainingDailyQuotaOrNull() {
  try {
    return GmailApp.getRemainingDailyQuota();
  } catch (quotaError) {
    console.error('gmail_quota_read_after_send_failed: ' + quotaError.message);
    return null;
  }
}

function getOrCreateDeliverySheet() {
  return getOrCreateSheet(DELIVERY_SHEET_NAME, DELIVERY_SHEET_HEADERS);
}

function getOrCreateBookingMirrorSheet() {
  return getOrCreateSheet(BOOKING_MIRROR_SHEET_NAME, BOOKING_MIRROR_SHEET_HEADERS);
}

function getOrCreateSheet(sheetName, headerLabels) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('spreadsheet_not_available');
  }

  var targetSheet = spreadsheet.getSheetByName(sheetName);
  if (!targetSheet) {
    targetSheet = spreadsheet.insertSheet(sheetName);
  }

  ensureSheetHeaderRow(targetSheet, headerLabels);
  return targetSheet;
}

function ensureSheetHeaderRow(targetSheet, headerLabels) {
  var headerRange = targetSheet.getRange(1, 1, 1, headerLabels.length);
  var currentHeaders = headerRange.getValues()[0];
  var headersMatch = headerLabels.every(function (headerLabel, index) {
    return String(currentHeaders[index] || '') === headerLabel;
  });

  if (!headersMatch) {
    headerRange.setValues([headerLabels]);
    headerRange.setFontWeight('bold');
    targetSheet.setFrozenRows(1);
  }

  // Sheet cells are plain text, so an attendee name starting with "=" can never
  // be evaluated as a formula. This mirrors the CSV export's injection guard.
  var availableDataRowCount = targetSheet.getMaxRows() - 1;
  if (availableDataRowCount > 0) {
    targetSheet
      .getRange(2, 1, availableDataRowCount, headerLabels.length)
      .setNumberFormat('@');
  }
}

function readSheetRowsByHeader(targetSheet, headerLabels) {
  var lastRow = targetSheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  var sheetValues = targetSheet
    .getRange(2, 1, lastRow - 1, headerLabels.length)
    .getValues();

  return sheetValues.map(function (sheetRowValues) {
    var rowObject = {};
    headerLabels.forEach(function (headerLabel, columnIndex) {
      rowObject[headerLabel] = sheetRowValues[columnIndex];
    });
    return rowObject;
  });
}

function findDeliveryRow(deliverySheet, deliveryKey) {
  var lastRow = deliverySheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  var keyColumnIndex = DELIVERY_SHEET_HEADERS.indexOf('Delivery key') + 1;
  var deliveryValues = deliverySheet
    .getRange(2, 1, lastRow - 1, DELIVERY_SHEET_HEADERS.length)
    .getValues();

  for (var rowIndex = 0; rowIndex < deliveryValues.length; rowIndex += 1) {
    if (String(deliveryValues[rowIndex][keyColumnIndex - 1]) !== deliveryKey) {
      continue;
    }

    var deliveryRow = { rowNumber: rowIndex + 2 };
    for (var columnIndex = 0; columnIndex < DELIVERY_SHEET_HEADERS.length; columnIndex += 1) {
      deliveryRow[DELIVERY_SHEET_HEADERS[columnIndex]] =
        deliveryValues[rowIndex][columnIndex];
    }

    return deliveryRow;
  }

  return null;
}

function upsertDeliveryRow(
  deliverySheet,
  existingDeliveryRow,
  emailRequest,
  outcome,
  attemptCountIncrement
) {
  var attemptedAt = formatTimestamp(new Date());
  var firstAttemptedAt = existingDeliveryRow
    ? existingDeliveryRow['First attempted at'] || attemptedAt
    : attemptedAt;
  var previousAttemptCount = existingDeliveryRow
    ? Number(existingDeliveryRow['Attempt count']) || 0
    : 0;

  var valuesByHeader = {
    'Delivery key': emailRequest.deliveryKey,
    'Email kind': emailRequest.emailKind,
    'Booking reference': emailRequest.booking.referenceCode || '',
    'Attendee name': emailRequest.booking.attendeeName || '',
    'Email address': emailRequest.booking.attendeeEmailAddress || '',
    'Phone number': emailRequest.booking.attendeePhoneNumber || '',
    'Booking status': emailRequest.booking.bookingStatus || '',
    Event: emailRequest.event.title || '',
    'Event date': emailRequest.event.dateLabel || '',
    'Event time': emailRequest.event.timeLabel || '',
    Venue: emailRequest.event.venue || '',
    'Ticket type': emailRequest.ticket.ticketTypeLabel || '',
    Amount: emailRequest.ticket.amount || '',
    Currency: emailRequest.ticket.currency || '',
    'Delivery status': outcome.deliveryStatus,
    'Delivery id': outcome.deliveryId,
    Error: truncateErrorMessage(outcome.errorMessage),
    'Attempt count': previousAttemptCount + attemptCountIncrement,
    'First attempted at': firstAttemptedAt,
    'Last attempted at': attemptedAt,
  };

  var rowValues = DELIVERY_SHEET_HEADERS.map(function (headerLabel) {
    return valuesByHeader[headerLabel];
  });

  if (existingDeliveryRow) {
    deliverySheet
      .getRange(existingDeliveryRow.rowNumber, 1, 1, rowValues.length)
      .setValues([rowValues]);
    return;
  }

  deliverySheet.appendRow(rowValues);
}

function formatTimestamp(dateValue) {
  return dateValue.toISOString();
}

function isDeliveryLeaseActive(lastAttemptedAt) {
  var lastAttemptedAtMilliseconds = Date.parse(String(lastAttemptedAt || ''));

  if (!Number.isFinite(lastAttemptedAtMilliseconds)) {
    return false;
  }

  return Date.now() - lastAttemptedAtMilliseconds < DELIVERY_LEASE_MILLISECONDS;
}

function truncateErrorMessage(errorMessage) {
  var normalizedErrorMessage = String(errorMessage || '');
  return normalizedErrorMessage.length > MAXIMUM_ERROR_LENGTH
    ? normalizedErrorMessage.slice(0, MAXIMUM_ERROR_LENGTH)
    : normalizedErrorMessage;
}

function readSafeErrorCode(error) {
  var errorCode = String(error && error.message ? error.message : '');

  return SAFE_ERROR_CODES[errorCode] ? errorCode : 'apps_script_error';
}

function buildJsonResponse(responsePayload) {
  return ContentService.createTextOutput(JSON.stringify(responsePayload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Runs inside the Apps Script editor once to grant the Gmail permission and
 * prove the deployment can send. It does not touch the Sheet.
 */
function sendTestEmailToScriptOwner() {
  var ownerEmailAddress = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(
    ownerEmailAddress,
    'Ticket email web app is connected',
    'If you can read this, the Apps Script deployment can send ticket emails.'
  );

  return ownerEmailAddress;
}

/**
 * Runs inside the Apps Script editor to diagnose the real webhook path.
 * It checks the secret, the bound Sheet, the Gmail quota, and a live send,
 * then writes the result to Apps Script -> Executions.
 *
 * It sends one short test email to the script owner; it does not send a ticket
 * and does not write a delivery row.
 */
function diagnoseTicketEmailDelivery() {
  var diagnosticReport = {
    sharedSecretConfigured: false,
    spreadsheetAvailable: false,
    remainingDailyQuota: null,
    testEmailSent: false,
    errorMessage: '',
  };

  try {
    diagnosticReport.sharedSecretConfigured = Boolean(
      PropertiesService.getScriptProperties().getProperty('SHARED_SECRET')
    );

    diagnosticReport.spreadsheetAvailable = Boolean(
      SpreadsheetApp.getActiveSpreadsheet()
    );

    diagnosticReport.remainingDailyQuota =
      GmailApp.getRemainingDailyQuota();

    var ownerEmailAddress =
      Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail();

    if (!ownerEmailAddress) {
      throw new Error('No owner email address is available for the test send');
    }

    GmailApp.sendEmail(
      ownerEmailAddress,
      'Ticket email diagnostic passed',
      'GmailApp can send from this Apps Script deployment.'
    );
    diagnosticReport.testEmailSent = true;
  } catch (diagnosticError) {
    diagnosticReport.errorMessage =
      diagnosticError && diagnosticError.message
        ? diagnosticError.message
        : String(diagnosticError);

    console.error(
      'diagnoseTicketEmailDelivery failed: ' + diagnosticReport.errorMessage
    );
  }

  console.log(JSON.stringify(diagnosticReport));
  return diagnosticReport;
}
