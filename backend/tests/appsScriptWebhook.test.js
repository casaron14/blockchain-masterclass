// Exercises the real apps-script/Code.gs inside a fake Apps Script runtime.
// This is the closest we can get to "does the deployed web app behave" without
// a Google account: GmailApp, SpreadsheetApp, PropertiesService, Utilities and
// LockService are replaced with in-memory fakes, and doPost runs unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const APPS_SCRIPT_SOURCE_CODE = fs.readFileSync(
  new URL('../../apps-script/Code.gs', import.meta.url),
  'utf8'
);

function createFakeDeliverySheet() {
  const sheetRows = [];
  let numberFormatCallCount = 0;

  function readRangeValues(startRowNumber, startColumnNumber, rowCount, columnCount) {
    const rangeValues = [];

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
      const sheetRow = sheetRows[startRowNumber - 1 + rowOffset] ?? [];
      const rowValues = [];

      for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
        rowValues.push(sheetRow[startColumnNumber - 1 + columnOffset] ?? '');
      }

      rangeValues.push(rowValues);
    }

    return rangeValues;
  }

  return {
    sheetRows,
    readNumberFormatCallCount() {
      return numberFormatCallCount;
    },
    getLastRow() {
      return sheetRows.length;
    },
    getMaxRows() {
      return Math.max(sheetRows.length, 1000);
    },
    getRange(startRowNumber, startColumnNumber, rowCount, columnCount) {
      return {
        getValues() {
          return readRangeValues(
            startRowNumber,
            startColumnNumber,
            rowCount,
            columnCount
          );
        },
        setValues(rangeValues) {
          rangeValues.forEach((rowValues, rowOffset) => {
            const targetRowIndex = startRowNumber - 1 + rowOffset;
            const targetRow = sheetRows[targetRowIndex] ?? [];
            rowValues.forEach((cellValue, columnOffset) => {
              targetRow[startColumnNumber - 1 + columnOffset] = cellValue;
            });
            sheetRows[targetRowIndex] = targetRow;
          });
        },
        setFontWeight() {},
        setNumberFormat() {
          numberFormatCallCount += 1;
        },
      };
    },
    appendRow(rowValues) {
      sheetRows.push([...rowValues]);
    },
    setFrozenRows() {},
  };
}

function createAppsScriptTestEnvironment(options = {}) {
  const sheetsByName = new Map();
  const sentMessages = [];
  const scriptProperties = new Map(
    options.sharedSecret === null
      ? []
      : [['SHARED_SECRET', options.sharedSecret ?? 'test-shared-secret']]
  );
  let remainingDailyQuota = options.remainingDailyQuota ?? 99;
  let failOnSend = options.failOnSend === true;
  let failOnQuotaCheck = false;
  let generatedUuidCount = 0;

  function getOrCreateFakeSheet(sheetName) {
    if (!sheetsByName.has(sheetName)) {
      sheetsByName.set(sheetName, createFakeDeliverySheet());
    }

    return sheetsByName.get(sheetName);
  }

  const spreadsheetApplication = {
    getActiveSpreadsheet() {
      return {
        getSheetByName(sheetName) {
          return sheetsByName.get(sheetName) ?? null;
        },
        insertSheet(sheetName) {
          return getOrCreateFakeSheet(sheetName);
        },
      };
    },
  };

  const gmailApplication = {
    sendEmail(recipientEmailAddress, emailSubject, emailBody, advancedOptions = {}) {
      if (failOnSend) {
        throw new Error('Gmail service refused the message');
      }

      sentMessages.push({
        to: recipientEmailAddress,
        subject: emailSubject,
        body: emailBody,
        ...advancedOptions,
      });
    },
  };

  const mailApplication = {
    getRemainingDailyQuota() {
      if (failOnQuotaCheck) {
        throw new Error('Mail quota permission is missing');
      }

      return remainingDailyQuota;
    },
  };

  const sandbox = {
    console,
    SpreadsheetApp: spreadsheetApplication,
    GmailApp: gmailApplication,
    MailApp: mailApplication,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(propertyName) {
            return scriptProperties.get(propertyName) ?? null;
          },
        };
      },
    },
    Utilities: {
      formatDate(dateValue) {
        return dateValue.toISOString();
      },
      getUuid() {
        generatedUuidCount += 1;
        return `delivery-id-${generatedUuidCount}`;
      },
      base64Decode(base64Content) {
        return [...Buffer.from(base64Content, 'base64')];
      },
      newBlob(decodedBytes, mimeType, fileName) {
        return {
          decodedBytes,
          mimeType,
          fileName,
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            return true;
          },
          hasLock() {
            return true;
          },
          releaseLock() {},
        };
      },
    },
    Session: {
      getScriptTimeZone() {
        return 'Africa/Dar_es_Salaam';
      },
      getActiveUser() {
        return { getEmail: () => 'owner@example.com' };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(outputText) {
        return {
          outputText,
          setMimeType() {
            return this;
          },
          getContent() {
            return this.outputText;
          },
        };
      },
    },
  };

  const executionContext = vm.createContext(sandbox);
  vm.runInContext(APPS_SCRIPT_SOURCE_CODE, executionContext, {
    filename: 'Code.gs',
  });

  return {
    get deliverySheet() {
      return sheetsByName.get('Ticket deliveries');
    },
    get bookingMirrorSheet() {
      return sheetsByName.get('Bookings');
    },
    sentMessages,
    setRemainingDailyQuota(nextQuota) {
      remainingDailyQuota = nextQuota;
    },
    setFailOnSend(nextFailOnSend) {
      failOnSend = nextFailOnSend;
    },
    setFailOnQuotaCheck(nextFailOnQuotaCheck) {
      failOnQuotaCheck = nextFailOnQuotaCheck;
    },
    invokeDoPost(requestBody) {
      const response = sandbox.doPost({
        postData: {
          contents:
            typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody),
        },
      });

      return JSON.parse(response.getContent());
    },
    invokeDoGet() {
      const response = sandbox.doGet();
      return JSON.parse(response.getContent());
    },
    invokeDiagnose() {
      return sandbox.diagnoseTicketEmailDelivery();
    },
    invokeSendTestEmail() {
      return sandbox.sendTestEmailToScriptOwner();
    },
  };
}

function buildWebhookRequestBody(emailRequestOverrides = {}, topLevelOverrides = {}) {
  return {
    sharedSecret: 'test-shared-secret',
    emailRequest: {
      deliveryKey: 'ticket:EVT-TEST01',
      emailKind: 'ticket',
      recipientEmailAddress: 'attendee@example.com',
      emailSubject: 'Your Blockchain Masterclass ticket (EVT-TEST01)',
      emailTextBody: 'Your ticket is attached.',
      emailHtmlBody: '<p>Your ticket is attached.</p>',
      senderDisplayName: 'DienAcademy Events',
      replyToEmailAddress: 'support@dienacademy.com',
      attachments: [
        {
          fileName: 'ticket-EVT-TEST01.png',
          mimeType: 'image/png',
          base64Content: Buffer.from('fake-png-bytes').toString('base64'),
        },
      ],
      booking: {
        referenceCode: 'EVT-TEST01',
        attendeeName: 'Test Attendee',
        attendeeEmailAddress: 'attendee@example.com',
        attendeePhoneNumber: '+255700000001',
        bookingStatus: 'confirmed',
      },
      event: {
        title: 'Blockchain Masterclass',
        dateLabel: '7th November 2026',
        timeLabel: '6:00 PM',
        venue: 'Arusha, Tanzania',
      },
      ticket: {
        ticketTypeLabel: 'General Admission',
        amount: 10000,
        currency: 'TZS',
      },
      ...emailRequestOverrides,
    },
    ...topLevelOverrides,
  };
}

function readDeliveryRowByKey(deliverySheet, deliveryKey) {
  const headers = deliverySheet.sheetRows[0];
  const rowIndex = deliverySheet.sheetRows.findIndex(
    (sheetRow, candidateIndex) =>
      candidateIndex > 0 && sheetRow[headers.indexOf('Delivery key')] === deliveryKey
  );

  if (rowIndex === -1) {
    return null;
  }

  return Object.fromEntries(
    headers.map((headerLabel, columnIndex) => [headerLabel, deliverySheet.sheetRows[rowIndex][columnIndex]])
  );
}

function buildBookingSyncRequestBody(bookings) {
  return {
    sharedSecret: 'test-shared-secret',
    requestType: 'sync_bookings',
    syncedAt: '2026-11-07T18:00:00.000Z',
    bookings,
  };
}

function buildBookingMirrorRecord(overrides = {}) {
  return {
    bookingReference: 'EVT-TEST01',
    attendeeName: 'Test Attendee',
    emailAddress: 'attendee@example.com',
    phoneNumber: '+255700000001',
    bookingStatus: 'confirmed',
    paymentStatus: 'confirmed',
    paymentMethod: 'lipanamba',
    paymentAmount: 10000,
    paymentCurrency: 'TZS',
    referrerName: 'neema',
    ticketSentAt: '2026-11-07T18:00:00.000Z',
    bookingCreatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function readBookingMirrorRowByReference(bookingMirrorSheet, bookingReference) {
  const headers = bookingMirrorSheet.sheetRows[0];
  const rowIndex = bookingMirrorSheet.sheetRows.findIndex(
    (sheetRow, candidateIndex) =>
      candidateIndex > 0 &&
      sheetRow[headers.indexOf('Booking reference')] === bookingReference
  );

  if (rowIndex === -1) {
    return null;
  }

  return Object.fromEntries(
    headers.map((headerLabel, columnIndex) => [
      headerLabel,
      bookingMirrorSheet.sheetRows[rowIndex][columnIndex],
    ])
  );
}

test('doPost rejects a request with the wrong shared secret and sends nothing', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody({}, { sharedSecret: 'wrong-secret' })
  );

  assert.deepEqual(responsePayload, { ok: false, error: 'unauthorized' });
  assert.equal(appsScriptEnvironment.sentMessages.length, 0);
  assert.equal(appsScriptEnvironment.deliverySheet, undefined);
});

test('doPost refuses every request when the SHARED_SECRET script property is missing', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment({
    sharedSecret: null,
  });

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.deepEqual(responsePayload, {
    ok: false,
    error: 'apps_script_secret_not_configured',
  });
  assert.equal(appsScriptEnvironment.sentMessages.length, 0);
});

test('doPost sends one ticket email and mirrors it into the Sheet', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.equal(responsePayload.ok, true);
  assert.equal(responsePayload.deliveryId, 'delivery-id-1');
  assert.equal(responsePayload.remainingDailyQuota, 99);

  assert.equal(appsScriptEnvironment.sentMessages.length, 1);
  const sentMessage = appsScriptEnvironment.sentMessages[0];
  assert.equal(sentMessage.to, 'attendee@example.com');
  assert.equal(sentMessage.subject, 'Your Blockchain Masterclass ticket (EVT-TEST01)');
  assert.equal(sentMessage.name, 'DienAcademy Events');
  assert.equal(sentMessage.replyTo, 'support@dienacademy.com');
  assert.equal(sentMessage.attachments.length, 1);
  assert.equal(sentMessage.attachments[0].fileName, 'ticket-EVT-TEST01.png');
  assert.equal(sentMessage.attachments[0].mimeType, 'image/png');
  assert.deepEqual(
    Buffer.from(sentMessage.attachments[0].decodedBytes).toString(),
    'fake-png-bytes'
  );

  const deliveryRow = readDeliveryRowByKey(
    appsScriptEnvironment.deliverySheet,
    'ticket:EVT-TEST01'
  );
  assert.equal(deliveryRow['Delivery status'], 'sent');
  assert.equal(deliveryRow['Email kind'], 'ticket');
  assert.equal(deliveryRow['Attendee name'], 'Test Attendee');
  assert.equal(deliveryRow['Event time'], '6:00 PM');
  assert.equal(deliveryRow['Attempt count'], 1);
  assert.equal(deliveryRow['Delivery id'], 'delivery-id-1');
  assert.equal(deliveryRow.Error, '');
});

test('doPost never sends the same delivery key twice', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const firstResponsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );
  const secondResponsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.equal(firstResponsePayload.ok, true);
  assert.deepEqual(secondResponsePayload, {
    ok: true,
    duplicate: true,
    deliveryId: firstResponsePayload.deliveryId,
    remainingDailyQuota: 99,
  });
  assert.equal(appsScriptEnvironment.sentMessages.length, 1);

  const deliveryRow = readDeliveryRowByKey(
    appsScriptEnvironment.deliverySheet,
    'ticket:EVT-TEST01'
  );
  assert.equal(deliveryRow['Attempt count'], 1);
});

test('doPost attempts the send when the Gmail quota cannot be read', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();
  appsScriptEnvironment.setFailOnQuotaCheck(true);

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.equal(responsePayload.ok, true);
  assert.equal(appsScriptEnvironment.sentMessages.length, 1);
  assert.equal(appsScriptEnvironment.sentMessages[0].to, 'attendee@example.com');
});

test('doPost records a failed row and does not send when the daily quota is exhausted', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment({
    remainingDailyQuota: 0,
  });

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.deepEqual(responsePayload, {
    ok: false,
    error: 'daily_quota_exhausted',
  });
  assert.equal(appsScriptEnvironment.sentMessages.length, 0);

  const deliveryRow = readDeliveryRowByKey(
    appsScriptEnvironment.deliverySheet,
    'ticket:EVT-TEST01'
  );
  assert.equal(deliveryRow['Delivery status'], 'failed');
  assert.equal(deliveryRow.Error, 'daily_quota_exhausted');
});

test('doPost records a mail failure and retries the same row on the next attempt', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment({
    failOnSend: true,
  });

  const failedResponsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.deepEqual(failedResponsePayload, {
    ok: false,
    error: 'mail_send_failed',
    mailErrorMessage: 'Gmail service refused the message',
  });

  const failedDeliveryRow = readDeliveryRowByKey(
    appsScriptEnvironment.deliverySheet,
    'ticket:EVT-TEST01'
  );
  assert.equal(failedDeliveryRow['Delivery status'], 'failed');
  assert.equal(failedDeliveryRow.Error, 'Gmail service refused the message');
  assert.equal(failedDeliveryRow['Attempt count'], 1);

  appsScriptEnvironment.setFailOnSend(false);
  const recoveredResponsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.equal(recoveredResponsePayload.ok, true);
  assert.equal(appsScriptEnvironment.sentMessages.length, 1);

  const recoveredDeliveryRow = readDeliveryRowByKey(
    appsScriptEnvironment.deliverySheet,
    'ticket:EVT-TEST01'
  );
  assert.equal(recoveredDeliveryRow['Delivery status'], 'sent');
  assert.equal(recoveredDeliveryRow['Attempt count'], 2);
  assert.equal(recoveredDeliveryRow.Error, '');
  assert.equal(appsScriptEnvironment.deliverySheet.sheetRows.length, 2);
});

test('doPost refuses to resend while a crashed send still holds the delivery lease', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment({
    remainingDailyQuota: 0,
  });

  // Create the sheet, the header row and one failed delivery row.
  appsScriptEnvironment.invokeDoPost(buildWebhookRequestBody());

  const sheetHeaders = appsScriptEnvironment.deliverySheet.sheetRows[0];
  const deliveryRow = appsScriptEnvironment.deliverySheet.sheetRows[1];
  deliveryRow[sheetHeaders.indexOf('Delivery status')] = 'sending';
  deliveryRow[sheetHeaders.indexOf('Last attempted at')] = new Date().toISOString();
  appsScriptEnvironment.setRemainingDailyQuota(99);

  const inProgressResponsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.deepEqual(inProgressResponsePayload, {
    ok: false,
    error: 'delivery_in_progress',
  });
  assert.equal(appsScriptEnvironment.sentMessages.length, 0);

  // Once the lease expires, the retry is allowed.
  deliveryRow[sheetHeaders.indexOf('Last attempted at')] = new Date(
    Date.now() - 20 * 60 * 1000
  ).toISOString();

  const retriedResponsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody()
  );

  assert.equal(retriedResponsePayload.ok, true);
  assert.equal(appsScriptEnvironment.sentMessages.length, 1);
  assert.equal(deliveryRow[sheetHeaders.indexOf('Delivery status')], 'sent');
  assert.equal(Number(deliveryRow[sheetHeaders.indexOf('Attempt count')]), 2);
});

test('doPost writes attendee text as plain text so a name cannot become a formula', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();
  const formulaLikeAttendeeName = '=HYPERLINK("https://example.test","click")';

  appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody({
      booking: { attendeeName: formulaLikeAttendeeName },
    })
  );

  assert.ok(appsScriptEnvironment.deliverySheet.readNumberFormatCallCount() > 0);

  const deliveryRow = readDeliveryRowByKey(
    appsScriptEnvironment.deliverySheet,
    'ticket:EVT-TEST01'
  );
  assert.equal(deliveryRow['Attendee name'], formulaLikeAttendeeName);
});

test('doPost keeps ticket and receipt deliveries in separate rows', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  appsScriptEnvironment.invokeDoPost(buildWebhookRequestBody());
  appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody({
      deliveryKey: 'receipt:EVT-TEST01',
      emailKind: 'receipt',
      emailSubject: 'Your payment receipt',
      attachments: [
        {
          fileName: 'receipt-EVT-TEST01.pdf',
          mimeType: 'application/pdf',
          base64Content: Buffer.from('fake-pdf-bytes').toString('base64'),
        },
      ],
    })
  );

  assert.equal(appsScriptEnvironment.sentMessages.length, 2);
  assert.equal(
    readDeliveryRowByKey(appsScriptEnvironment.deliverySheet, 'ticket:EVT-TEST01')[
      'Delivery status'
    ],
    'sent'
  );
  assert.equal(
    readDeliveryRowByKey(appsScriptEnvironment.deliverySheet, 'receipt:EVT-TEST01')[
      'Delivery status'
    ],
    'sent'
  );
});

test('doPost rejects an invalid recipient address before touching the Sheet', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildWebhookRequestBody({ recipientEmailAddress: 'not-an-email' })
  );

  assert.deepEqual(responsePayload, {
    ok: false,
    error: 'invalid_recipient',
  });
  assert.equal(appsScriptEnvironment.sentMessages.length, 0);
  assert.equal(appsScriptEnvironment.deliverySheet, undefined);
});

test('doPost rejects a malformed JSON body without exposing the error', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const responsePayload = appsScriptEnvironment.invokeDoPost('{not-json');

  assert.deepEqual(responsePayload, { ok: false, error: 'invalid_request' });
});

test('doPost sync_bookings creates the Bookings tab and mirrors every booking', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const responsePayload = appsScriptEnvironment.invokeDoPost(
    buildBookingSyncRequestBody([
      buildBookingMirrorRecord(),
      buildBookingMirrorRecord({
        bookingReference: 'EVT-TEST02',
        attendeeName: 'Second Attendee',
        emailAddress: 'second@example.com',
        bookingStatus: 'pending',
        paymentStatus: 'pending',
        ticketSentAt: '',
      }),
    ])
  );

  assert.deepEqual(responsePayload, {
    ok: true,
    requestType: 'sync_bookings',
    syncedCount: 2,
    createdCount: 2,
    updatedCount: 0,
  });
  assert.equal(appsScriptEnvironment.sentMessages.length, 0);

  const bookingMirrorSheet = appsScriptEnvironment.bookingMirrorSheet;
  assert.ok(bookingMirrorSheet);
  assert.equal(bookingMirrorSheet.sheetRows.length, 3);

  const mirroredBooking = readBookingMirrorRowByReference(
    bookingMirrorSheet,
    'EVT-TEST01'
  );
  assert.equal(mirroredBooking['Attendee name'], 'Test Attendee');
  assert.equal(mirroredBooking['Payment status'], 'confirmed');
  assert.equal(mirroredBooking['Payment method'], 'lipanamba');
  assert.equal(mirroredBooking.Amount, 10000);
  assert.equal(mirroredBooking.Currency, 'TZS');
  assert.equal(mirroredBooking.Referral, 'neema');
  assert.equal(mirroredBooking['Last synced at'], '2026-11-07T18:00:00.000Z');

  const pendingBooking = readBookingMirrorRowByReference(
    bookingMirrorSheet,
    'EVT-TEST02'
  );
  assert.equal(pendingBooking['Booking status'], 'pending');
  assert.equal(pendingBooking['Ticket sent at'], '');
});

test('doPost sync_bookings updates an existing booking instead of duplicating it', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  appsScriptEnvironment.invokeDoPost(
    buildBookingSyncRequestBody([buildBookingMirrorRecord()])
  );

  const secondSyncPayload = appsScriptEnvironment.invokeDoPost(
    buildBookingSyncRequestBody([
      buildBookingMirrorRecord({
        bookingStatus: 'confirmed',
        ticketSentAt: '2026-11-08T09:30:00.000Z',
      }),
    ])
  );

  assert.deepEqual(secondSyncPayload, {
    ok: true,
    requestType: 'sync_bookings',
    syncedCount: 1,
    createdCount: 0,
    updatedCount: 1,
  });

  const bookingMirrorSheet = appsScriptEnvironment.bookingMirrorSheet;
  assert.equal(bookingMirrorSheet.sheetRows.length, 2);
  assert.equal(
    readBookingMirrorRowByReference(bookingMirrorSheet, 'EVT-TEST01')['Ticket sent at'],
    '2026-11-08T09:30:00.000Z'
  );
});

test('doPost sync_bookings rejects the wrong secret and leaves the Bookings tab untouched', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const responsePayload = appsScriptEnvironment.invokeDoPost({
    ...buildBookingSyncRequestBody([buildBookingMirrorRecord()]),
    sharedSecret: 'wrong-secret',
  });

  assert.deepEqual(responsePayload, { ok: false, error: 'unauthorized' });
  assert.equal(appsScriptEnvironment.bookingMirrorSheet, undefined);
});

test('doPost sync_bookings writes attendee text as plain text so a name cannot become a formula', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();
  const formulaLikeAttendeeName = '=HYPERLINK("https://example.test","click")';

  appsScriptEnvironment.invokeDoPost(
    buildBookingSyncRequestBody([
      buildBookingMirrorRecord({ attendeeName: formulaLikeAttendeeName }),
    ])
  );

  const bookingMirrorSheet = appsScriptEnvironment.bookingMirrorSheet;
  assert.ok(bookingMirrorSheet.readNumberFormatCallCount() > 0);
  assert.equal(
    readBookingMirrorRowByReference(bookingMirrorSheet, 'EVT-TEST01')[
      'Attendee name'
    ],
    formulaLikeAttendeeName
  );
});

test('diagnoseTicketEmailDelivery still tests the send when the quota reader is unavailable', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();
  appsScriptEnvironment.setFailOnQuotaCheck(true);

  const diagnosticReport = appsScriptEnvironment.invokeDiagnose();

  assert.equal(diagnosticReport.sharedSecretConfigured, true);
  assert.equal(diagnosticReport.spreadsheetAvailable, true);
  assert.equal(diagnosticReport.remainingDailyQuota, null);
  assert.equal(diagnosticReport.testEmailSent, true);
  assert.equal(diagnosticReport.errorMessage, '');
  assert.equal(appsScriptEnvironment.sentMessages.length, 1);
});

test('doGet reports a public deployment health check', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  assert.deepEqual(appsScriptEnvironment.invokeDoGet(), {
    ok: true,
    service: 'ticket-email-and-sheet-sync',
    supportsBookingSync: true,
  });
  assert.equal(appsScriptEnvironment.deliverySheet, undefined);
});

test('sendTestEmailToScriptOwner sends one authorization check email', () => {
  const appsScriptEnvironment = createAppsScriptTestEnvironment();

  const ownerEmailAddress = appsScriptEnvironment.invokeSendTestEmail();

  assert.equal(ownerEmailAddress, 'owner@example.com');
  assert.equal(appsScriptEnvironment.sentMessages.length, 1);
  assert.equal(appsScriptEnvironment.sentMessages[0].to, 'owner@example.com');
});
