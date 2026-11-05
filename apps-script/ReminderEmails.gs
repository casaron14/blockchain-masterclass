// Reminder email campaign for confirmed bookings in the bound Sheet.

var REMINDER_DELIVERY_SHEET_NAME = 'Reminder deliveries';
var REMINDER_DELIVERY_SHEET_HEADERS = [
  'Recipient email',
  'Booking reference',
  'Attendee name',
  'Reminder status',
  'Delivery id',
  'Error',
  'Attempt count',
  'First attempted at',
  'Last attempted at',
  'Sent at',
];

// Keep these event details in sync with shared/eventConfig.js. Apps Script
// cannot import the repository module, so the reminder campaign owns its copy.
var REMINDER_EVENT_NAME = 'Blockchain Masterclass';
var REMINDER_EVENT_DATE_LABEL = 'Saturday, 7th November 2026';
var REMINDER_EVENT_VENUE = 'Village Hall Mafao House, Arusha, Tanzania';
var REMINDER_SUPPORT_PHONE_NUMBER = '+255 621 745 217';
var REMINDER_SUPPORT_EMAIL_ADDRESS = 'support@dienacademy.com';
var REMINDER_SENDER_DISPLAY_NAME = 'DienAcademy Events';
var REMINDER_BRAND_NAME = 'Inkryptus';
var REMINDER_SEND_LEASE_MILLISECONDS = 15 * 60 * 1000;

// Adds the reminder commands to the bound Sheet without changing the deployed
// web app. The menu appears after the Sheet is reopened.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Event emails')
    .addItem(
      'Count 2-days-to-go recipients',
      'showTwoDaysToGoReminderRecipientCount'
    )
    .addItem(
      'Send 2-days-to-go emails',
      'confirmAndSendTwoDaysToGoReminderEmailsToConfirmedClients'
    )
    .addToUi();
}

/**
 * Reads the Bookings tab, keeps only confirmed bookings, and returns one
 * recipient per email address. This is the duplicate-removal boundary for the
 * reminder campaign: a client with two bookings still receives one email.
 */
function deduplicateConfirmedBookingsByEmail(bookingRows) {
  var recipientsByEmailAddress = {};
  var confirmedBookingCount = 0;
  var duplicateEmailCount = 0;
  var invalidEmailCount = 0;

  (bookingRows || []).forEach(function (bookingRow) {
    if (
      String(bookingRow['Booking status'] || '')
        .trim()
        .toLowerCase() !== 'confirmed'
    ) {
      return;
    }

    confirmedBookingCount += 1;

    var recipientEmailAddress = normalizeReminderRecipientEmailAddress(
      bookingRow['Email address']
    );

    if (!EMAIL_ADDRESS_PATTERN.test(recipientEmailAddress)) {
      invalidEmailCount += 1;
      return;
    }

    if (recipientsByEmailAddress[recipientEmailAddress]) {
      duplicateEmailCount += 1;
      return;
    }

    recipientsByEmailAddress[recipientEmailAddress] = {
      recipientEmailAddress: recipientEmailAddress,
      bookingReference: String(bookingRow['Booking reference'] || '').trim(),
      attendeeName: String(bookingRow['Attendee name'] || '').trim(),
    };
  });

  return {
    recipients: Object.keys(recipientsByEmailAddress).map(function (
      recipientEmailAddress
    ) {
      return recipientsByEmailAddress[recipientEmailAddress];
    }),
    confirmedBookingCount: confirmedBookingCount,
    duplicateEmailCount: duplicateEmailCount,
    invalidEmailCount: invalidEmailCount,
  };
}

function normalizeReminderRecipientEmailAddress(emailAddressValue) {
  return String(emailAddressValue || '')
    .trim()
    .toLowerCase();
}

function countTwoDaysToGoReminderRecipientsFromConfirmedBookings() {
  var bookingMirrorSheet = getOrCreateBookingMirrorSheet();
  var bookingRows = readSheetRowsByHeader(
    bookingMirrorSheet,
    BOOKING_MIRROR_SHEET_HEADERS
  );
  var deduplicationResult = deduplicateConfirmedBookingsByEmail(bookingRows);

  return {
    confirmedBookingCount: deduplicationResult.confirmedBookingCount,
    uniqueRecipientCount: deduplicationResult.recipients.length,
    duplicateEmailCount: deduplicationResult.duplicateEmailCount,
    invalidEmailCount: deduplicationResult.invalidEmailCount,
  };
}

function showTwoDaysToGoReminderRecipientCount() {
  var recipientCountSummary =
    countTwoDaysToGoReminderRecipientsFromConfirmedBookings();
  var spreadsheetUi = SpreadsheetApp.getUi();

  spreadsheetUi.alert(
    '2-days-to-go recipients',
    'Confirmed bookings: ' +
      recipientCountSummary.confirmedBookingCount +
      '\nUnique recipients: ' +
      recipientCountSummary.uniqueRecipientCount +
      '\nDuplicate emails removed: ' +
      recipientCountSummary.duplicateEmailCount +
      '\nInvalid emails skipped: ' +
      recipientCountSummary.invalidEmailCount,
    spreadsheetUi.ButtonSet.OK
  );

  return recipientCountSummary;
}

function confirmAndSendTwoDaysToGoReminderEmailsToConfirmedClients() {
  var spreadsheetUi = SpreadsheetApp.getUi();
  var recipientCountSummary =
    countTwoDaysToGoReminderRecipientsFromConfirmedBookings();
  var userResponse = spreadsheetUi.alert(
    'Send 2-days-to-go emails?',
    recipientCountSummary.uniqueRecipientCount +
      ' unique confirmed recipient(s) will receive the reminder.\n' +
      'Duplicate emails removed: ' +
      recipientCountSummary.duplicateEmailCount +
      '\nInvalid emails skipped: ' +
      recipientCountSummary.invalidEmailCount,
    spreadsheetUi.ButtonSet.YES_NO
  );

  if (userResponse !== spreadsheetUi.Button.YES) {
    return null;
  }

  return sendTwoDaysToGoReminderEmailsToConfirmedClients();
}

/**
 * Sends the "2 days to go" reminder to each confirmed client in the Bookings
 * tab. A sent recipient is final, so running the function again is safe.
 */
function sendTwoDaysToGoReminderEmailsToConfirmedClients() {
  var scriptLock = LockService.getScriptLock();

  if (!scriptLock.tryLock(LOCK_WAIT_MILLISECONDS)) {
    return {
      ok: false,
      error: 'script_busy',
      sentCount: 0,
      failedCount: 0,
    };
  }

  try {
    var reminderDeliverySheet = getOrCreateSheet(
      REMINDER_DELIVERY_SHEET_NAME,
      REMINDER_DELIVERY_SHEET_HEADERS
    );
    var bookingMirrorSheet = getOrCreateBookingMirrorSheet();
    var bookingRows = readSheetRowsByHeader(
      bookingMirrorSheet,
      BOOKING_MIRROR_SHEET_HEADERS
    );
    var deduplicationResult = deduplicateConfirmedBookingsByEmail(bookingRows);
    var reminderDeliveryRowsByEmailAddress =
      readReminderDeliveryRowsByEmailAddress(reminderDeliverySheet);

    var campaignSummary = {
      ok: true,
      confirmedBookingCount: deduplicationResult.confirmedBookingCount,
      uniqueRecipientCount: deduplicationResult.recipients.length,
      duplicateEmailCount: deduplicationResult.duplicateEmailCount,
      invalidEmailCount: deduplicationResult.invalidEmailCount,
      sentCount: 0,
      skippedAlreadySentCount: 0,
      skippedInProgressCount: 0,
      failedCount: 0,
      dailyQuotaExhausted: false,
    };

    deduplicationResult.recipients.forEach(function (reminderRecipient) {
      var existingReminderRow =
        reminderDeliveryRowsByEmailAddress[
          reminderRecipient.recipientEmailAddress
        ] || null;

      if (
        existingReminderRow &&
        existingReminderRow['Reminder status'] === 'sent'
      ) {
        campaignSummary.skippedAlreadySentCount += 1;
        return;
      }

      if (
        existingReminderRow &&
        existingReminderRow['Reminder status'] === 'sending' &&
        isReminderDeliveryLeaseActive(existingReminderRow['Last attempted at'])
      ) {
        campaignSummary.skippedInProgressCount += 1;
        return;
      }

      // A null quota means the runtime cannot read it. Attempt the send and let
      // Gmail return the real error instead of refusing every recipient.
      var remainingDailyQuota = readRemainingDailyQuota();
      if (remainingDailyQuota !== null && remainingDailyQuota <= 0) {
        campaignSummary.dailyQuotaExhausted = true;
        return;
      }

      var reminderDeliveryId = Utilities.getUuid();
      upsertReminderDeliveryRow(
        reminderDeliverySheet,
        existingReminderRow,
        reminderRecipient,
        {
          reminderStatus: 'sending',
          deliveryId: reminderDeliveryId,
          errorMessage: '',
          sentAt: '',
        },
        1
      );

      var reservedReminderRow = findReminderDeliveryRowByEmailAddress(
        reminderDeliverySheet,
        reminderRecipient.recipientEmailAddress
      );

      try {
        var reminderEmail = buildTwoDaysToGoReminderEmailForRecipient(
          reminderRecipient
        );

        GmailApp.sendEmail(
          reminderRecipient.recipientEmailAddress,
          reminderEmail.subject,
          reminderEmail.textBody,
          {
            htmlBody: reminderEmail.htmlBody,
            name: REMINDER_SENDER_DISPLAY_NAME,
            replyTo: REMINDER_SUPPORT_EMAIL_ADDRESS,
          }
        );

        upsertReminderDeliveryRow(
          reminderDeliverySheet,
          reservedReminderRow,
          reminderRecipient,
          {
            reminderStatus: 'sent',
            deliveryId: reminderDeliveryId,
            errorMessage: '',
            sentAt: formatTimestamp(new Date()),
          },
          0
        );

        campaignSummary.sentCount += 1;
      } catch (reminderMailError) {
        var reminderErrorMessage = truncateErrorMessage(
          reminderMailError && reminderMailError.message
        );
        console.error('reminder_mail_send_failed: ' + reminderErrorMessage);

        upsertReminderDeliveryRow(
          reminderDeliverySheet,
          reservedReminderRow,
          reminderRecipient,
          {
            reminderStatus: 'failed',
            deliveryId: reminderDeliveryId,
            errorMessage: reminderErrorMessage,
            sentAt: '',
          },
          0
        );

        campaignSummary.failedCount += 1;
      }
    });

    return campaignSummary;
  } finally {
    if (scriptLock.hasLock()) {
      scriptLock.releaseLock();
    }
  }
}

function buildTwoDaysToGoReminderEmailForRecipient(reminderRecipient) {
  var attendeeName = String(reminderRecipient.attendeeName || '').trim();
  var greetingName = attendeeName || 'there';
  var escapedGreetingName = escapeHtmlTextForReminderEmail(greetingName);
  var escapedEventName = escapeHtmlTextForReminderEmail(REMINDER_EVENT_NAME);
  var escapedEventDateLabel = escapeHtmlTextForReminderEmail(
    REMINDER_EVENT_DATE_LABEL
  );
  var escapedEventVenue = escapeHtmlTextForReminderEmail(REMINDER_EVENT_VENUE);
  var escapedSupportPhoneNumber = escapeHtmlTextForReminderEmail(
    REMINDER_SUPPORT_PHONE_NUMBER
  );
  var escapedBrandName = escapeHtmlTextForReminderEmail(REMINDER_BRAND_NAME);

  var subject =
    '2 days to go: ' + REMINDER_EVENT_NAME + ' (' + REMINDER_EVENT_DATE_LABEL + ')';

  var textBody = [
    'Hi ' + greetingName + ',',
    '',
    'The ' + REMINDER_EVENT_NAME + ' is just 2 days away.',
    '',
    'Date: ' + REMINDER_EVENT_DATE_LABEL,
    'Venue: ' + REMINDER_EVENT_VENUE,
    '',
    'Please arrive early and bring:',
    '- Your ticket PDF from your confirmation email, on your phone or printed',
    '- A valid photo ID',
    '',
    'If you cannot find your ticket, reply to this email or call ' +
      REMINDER_SUPPORT_PHONE_NUMBER +
      '.',
    '',
    'See you there,',
    REMINDER_BRAND_NAME,
  ].join('\n');

  var htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedEventName} is in 2 days</title>
</head>
<body style="margin:0;padding:0;background-color:#E5E5E5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E5E5E5;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#000000;border:1px solid #2A2A2A;">
          <tr>
            <td style="padding:30px 34px 24px 34px;border-bottom:1px solid #444444;">
              <div style="font-family:'Courier New',Courier,monospace;font-size:13px;letter-spacing:4px;color:#FFFFFF;">${escapedBrandName.toUpperCase()}</div>
              <div style="font-family:Helvetica,Arial,sans-serif;font-size:28px;line-height:1.2;color:#FFFFFF;margin-top:16px;">2 days to go</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 34px 0 34px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#FFFFFF;">Hi ${escapedGreetingName},</p>
              <p style="margin:12px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#C9C9C9;">The ${escapedEventName} is just 2 days away. We look forward to seeing you.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 34px 0 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #444444;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1px;color:#8A8A8A;width:30%;">DATE</td>
                  <td style="padding:10px 0;border-bottom:1px solid #444444;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#FFFFFF;">${escapedEventDateLabel}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #444444;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1px;color:#8A8A8A;">VENUE</td>
                  <td style="padding:10px 0;border-bottom:1px solid #444444;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#FFFFFF;">${escapedEventVenue}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 34px 0 34px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#C9C9C9;">Please arrive early and bring:</p>
              <ul style="margin:10px 0 0 0;padding-left:20px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#C9C9C9;">
                <li>Your ticket PDF from your confirmation email, on your phone or printed</li>
                <li>A valid photo ID</li>
              </ul>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 34px 30px 34px;">
              <div style="border-top:1px solid #444444;padding-top:16px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8A8A8A;">
                If you cannot find your ticket, reply to this email or call ${escapedSupportPhoneNumber}.
              </div>
              <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#FFFFFF;margin-top:18px;">See you there,<br />${escapedBrandName}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: subject,
    textBody: textBody,
    htmlBody: htmlBody,
  };
}

function escapeHtmlTextForReminderEmail(htmlTextValue) {
  return String(htmlTextValue)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readReminderDeliveryRowsByEmailAddress(reminderDeliverySheet) {
  var lastRow = reminderDeliverySheet.getLastRow();
  if (lastRow < 2) {
    return {};
  }

  var sheetValues = reminderDeliverySheet
    .getRange(2, 1, lastRow - 1, REMINDER_DELIVERY_SHEET_HEADERS.length)
    .getValues();
  var reminderRowsByEmailAddress = {};

  sheetValues.forEach(function (sheetRowValues, rowOffset) {
    var reminderDeliveryRow = {
      rowNumber: rowOffset + 2,
    };

    REMINDER_DELIVERY_SHEET_HEADERS.forEach(function (
      headerLabel,
      columnIndex
    ) {
      reminderDeliveryRow[headerLabel] = sheetRowValues[columnIndex];
    });

    var recipientEmailAddress = normalizeReminderRecipientEmailAddress(
      reminderDeliveryRow['Recipient email']
    );

    if (recipientEmailAddress) {
      reminderRowsByEmailAddress[recipientEmailAddress] =
        reminderDeliveryRow;
    }
  });

  return reminderRowsByEmailAddress;
}

function findReminderDeliveryRowByEmailAddress(
  reminderDeliverySheet,
  recipientEmailAddress
) {
  var reminderRowsByEmailAddress =
    readReminderDeliveryRowsByEmailAddress(reminderDeliverySheet);

  return (
    reminderRowsByEmailAddress[
      normalizeReminderRecipientEmailAddress(recipientEmailAddress)
    ] || null
  );
}

function upsertReminderDeliveryRow(
  reminderDeliverySheet,
  existingReminderRow,
  reminderRecipient,
  outcome,
  attemptCountIncrement
) {
  var attemptedAt = formatTimestamp(new Date());
  var firstAttemptedAt = existingReminderRow
    ? existingReminderRow['First attempted at'] || attemptedAt
    : attemptedAt;
  var previousAttemptCount = existingReminderRow
    ? Number(existingReminderRow['Attempt count']) || 0
    : 0;

  var valuesByHeader = {
    'Recipient email': reminderRecipient.recipientEmailAddress,
    'Booking reference': reminderRecipient.bookingReference,
    'Attendee name': reminderRecipient.attendeeName,
    'Reminder status': outcome.reminderStatus,
    'Delivery id': outcome.deliveryId,
    Error: truncateErrorMessage(outcome.errorMessage),
    'Attempt count': previousAttemptCount + attemptCountIncrement,
    'First attempted at': firstAttemptedAt,
    'Last attempted at': attemptedAt,
    'Sent at': outcome.sentAt || '',
  };

  var rowValues = REMINDER_DELIVERY_SHEET_HEADERS.map(function (headerLabel) {
    return valuesByHeader[headerLabel];
  });

  if (existingReminderRow) {
    reminderDeliverySheet
      .getRange(existingReminderRow.rowNumber, 1, 1, rowValues.length)
      .setValues([rowValues]);
    return;
  }

  reminderDeliverySheet.appendRow(rowValues);
}

function isReminderDeliveryLeaseActive(lastAttemptedAt) {
  var lastAttemptedAtMilliseconds = Date.parse(String(lastAttemptedAt || ''));

  if (!Number.isFinite(lastAttemptedAtMilliseconds)) {
    return false;
  }

  return (
    Date.now() - lastAttemptedAtMilliseconds <
    REMINDER_SEND_LEASE_MILLISECONDS
  );
}

