import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookingMirrorRecordForSheet,
  buildGoogleSheetBookingSyncFailureMessage,
  buildGoogleSheetBookingSyncMessage,
  GoogleSheetBookingSyncError,
  resolveGoogleSheetSyncBatchSize,
  splitBookingsIntoBatches,
  syncAllBookingsToGoogleSheet,
} from '../services/googleSheetBookingSyncService.js';

import { AppsScriptWebhookError } from '../services/appsScriptWebhookClientService.js';

const TEST_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycb-test-deployment-id/exec';
const TEST_SHARED_SECRET = 'test-shared-secret-value';

async function withWebhookEnvironment(testBody) {
  const previousWebhookUrl = process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL;
  const previousSharedSecret = process.env.APPS_SCRIPT_SHARED_SECRET;
  process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL = TEST_WEBHOOK_URL;
  process.env.APPS_SCRIPT_SHARED_SECRET = TEST_SHARED_SECRET;

  try {
    return await testBody();
  } finally {
    if (previousWebhookUrl === undefined) {
      delete process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL;
    } else {
      process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL = previousWebhookUrl;
    }

    if (previousSharedSecret === undefined) {
      delete process.env.APPS_SCRIPT_SHARED_SECRET;
    } else {
      process.env.APPS_SCRIPT_SHARED_SECRET = previousSharedSecret;
    }
  }
}

function buildBookingRow(overrides = {}) {
  return {
    id: 1,
    ref: 'EVT-TEST01',
    full_name: 'Test Attendee',
    email: 'attendee@example.com',
    phone_number: '+255700000001',
    status: 'confirmed',
    payment_status: 'confirmed',
    payment_method: 'lipanamba',
    amount_expected: '10000.00',
    referrer_name: 'neema',
    utm_source: null,
    ticket_sent_at: new Date('2026-11-07T18:00:00.000Z'),
    created_at: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  };
}

test('buildBookingMirrorRecordForSheet maps the booking and payment fields', () => {
  const mirrorRecord = buildBookingMirrorRecordForSheet(buildBookingRow());

  assert.deepEqual(mirrorRecord, {
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
  });
});

test('buildBookingMirrorRecordForSheet labels a USDT payment with the crypto currency', () => {
  const mirrorRecord = buildBookingMirrorRecordForSheet(
    buildBookingRow({
      payment_method: 'usdt_bep20',
      amount_expected: '5.50',
      referrer_name: null,
      utm_source: 'instagram',
      ticket_sent_at: null,
    })
  );

  assert.equal(mirrorRecord.paymentCurrency, 'USDT');
  assert.equal(mirrorRecord.paymentAmount, 5.5);
  assert.equal(mirrorRecord.referrerName, 'instagram');
  assert.equal(mirrorRecord.ticketSentAt, '');
});

test('buildBookingMirrorRecordForSheet leaves the amount empty when the booking has no payment', () => {
  const mirrorRecord = buildBookingMirrorRecordForSheet(
    buildBookingRow({
      payment_status: null,
      payment_method: null,
      amount_expected: null,
    })
  );

  assert.equal(mirrorRecord.paymentStatus, '');
  assert.equal(mirrorRecord.paymentMethod, '');
  assert.equal(mirrorRecord.paymentAmount, '');
  assert.equal(mirrorRecord.paymentCurrency, 'TZS');
});

test('splitBookingsIntoBatches never puts more rows than the batch size in one request', () => {
  const bookingBatches = splitBookingsIntoBatches(
    [buildBookingRow({ ref: 'A' }), buildBookingRow({ ref: 'B' }), buildBookingRow({ ref: 'C' })],
    2
  );

  assert.equal(bookingBatches.length, 2);
  assert.deepEqual(
    bookingBatches.map((bookingBatch) => bookingBatch.map((bookingRow) => bookingRow.ref)),
    [['A', 'B'], ['C']]
  );
});

test('syncAllBookingsToGoogleSheet uploads every booking in batches and sums the counts', async () => {
  await withWebhookEnvironment(async () => {
    const postedRequestBodies = [];
    const bookingRows = [
      buildBookingRow({ id: 1, ref: 'EVT-TEST01' }),
      buildBookingRow({ id: 2, ref: 'EVT-TEST02' }),
      buildBookingRow({
        id: 3,
        ref: 'EVT-TEST03',
        payment_method: 'usdt_bep20',
        amount_expected: '5.50',
      }),
    ];

    const syncSummary = await syncAllBookingsToGoogleSheet({
      batchSize: 2,
      fetchBookingRows: async () => bookingRows,
      postRequest: async (requestBody) => {
        postedRequestBodies.push(requestBody);
        return {
          ok: true,
          requestType: 'sync_bookings',
          syncedCount: requestBody.bookings.length,
          createdCount: requestBody.bookings.length,
          updatedCount: 0,
        };
      },
    });

    assert.equal(postedRequestBodies.length, 2);
    assert.equal(postedRequestBodies[0].requestType, 'sync_bookings');
    assert.equal(postedRequestBodies[0].bookings.length, 2);
    assert.equal(postedRequestBodies[1].bookings.length, 1);
    assert.equal(postedRequestBodies[1].bookings[0].bookingReference, 'EVT-TEST03');
    assert.equal(postedRequestBodies[1].bookings[0].paymentCurrency, 'USDT');
    assert.ok(postedRequestBodies[0].syncedAt);

    assert.deepEqual(syncSummary, {
      totalBookingCount: 3,
      syncedBookingCount: 3,
      createdBookingCount: 3,
      updatedBookingCount: 0,
      failedBookingCount: 0,
      batchCount: 2,
      failedBatchCount: 0,
      failureReasons: [],
    });
  });
});

test('syncAllBookingsToGoogleSheet does not call the webhook when the database has no bookings', async () => {
  await withWebhookEnvironment(async () => {
    let webhookCallCount = 0;

    const syncSummary = await syncAllBookingsToGoogleSheet({
      fetchBookingRows: async () => [],
      postRequest: async () => {
        webhookCallCount += 1;
        return {};
      },
    });

    assert.equal(webhookCallCount, 0);
    assert.deepEqual(syncSummary, {
      totalBookingCount: 0,
      syncedBookingCount: 0,
      createdBookingCount: 0,
      updatedBookingCount: 0,
      failedBookingCount: 0,
      batchCount: 0,
      failedBatchCount: 0,
      failureReasons: [],
    });
  });
});

test('syncAllBookingsToGoogleSheet reports a partial batch failure instead of hiding it', async () => {
  await withWebhookEnvironment(async () => {
    let requestCount = 0;
    const bookingRows = [
      buildBookingRow({ id: 1, ref: 'EVT-TEST01' }),
      buildBookingRow({ id: 2, ref: 'EVT-TEST02' }),
    ];

    const syncSummary = await syncAllBookingsToGoogleSheet({
      batchSize: 1,
      fetchBookingRows: async () => bookingRows,
      postRequest: async (requestBody) => {
        requestCount += 1;
        if (requestCount === 2) {
          throw new AppsScriptWebhookError('APPS_SCRIPT_HTTP_500');
        }

        return {
          syncedCount: requestBody.bookings.length,
          createdCount: requestBody.bookings.length,
          updatedCount: 0,
        };
      },
    });

    assert.equal(syncSummary.syncedBookingCount, 1);
    assert.equal(syncSummary.failedBookingCount, 1);
    assert.equal(syncSummary.failedBatchCount, 1);
    assert.deepEqual(syncSummary.failureReasons, ['APPS_SCRIPT_HTTP_500']);
  });
});

test('syncAllBookingsToGoogleSheet throws when every batch fails', async () => {
  await withWebhookEnvironment(async () => {
    await assert.rejects(
      () =>
        syncAllBookingsToGoogleSheet({
          batchSize: 1,
          fetchBookingRows: async () => [buildBookingRow()],
          postRequest: async () => {
            throw new AppsScriptWebhookError('APPS_SCRIPT_REQUEST_TIMED_OUT');
          },
        }),
      (error) =>
        error instanceof GoogleSheetBookingSyncError &&
        error.syncSummary.failedBookingCount === 1 &&
        error.syncSummary.failureReasons[0] === 'APPS_SCRIPT_REQUEST_TIMED_OUT'
    );
  });
});

test('resolveGoogleSheetSyncBatchSize caps an oversized configured batch', () => {
  const previousBatchSize = process.env.GOOGLE_SHEET_SYNC_BATCH_SIZE;
  process.env.GOOGLE_SHEET_SYNC_BATCH_SIZE = '9999';

  try {
    assert.equal(resolveGoogleSheetSyncBatchSize(), 500);
  } finally {
    if (previousBatchSize === undefined) {
      delete process.env.GOOGLE_SHEET_SYNC_BATCH_SIZE;
    } else {
      process.env.GOOGLE_SHEET_SYNC_BATCH_SIZE = previousBatchSize;
    }
  }
});

test('buildGoogleSheetBookingSyncMessage describes an empty, complete, and partial sync', () => {
  assert.equal(
    buildGoogleSheetBookingSyncMessage({ totalBookingCount: 0 }),
    'There are no bookings to sync yet.'
  );
  assert.equal(
    buildGoogleSheetBookingSyncMessage({
      totalBookingCount: 1,
      syncedBookingCount: 1,
      failedBookingCount: 0,
    }),
    'Synced 1 booking to Google Sheets.'
  );
  assert.equal(
    buildGoogleSheetBookingSyncMessage({
      totalBookingCount: 3,
      syncedBookingCount: 2,
      failedBookingCount: 1,
    }),
    'Synced 2 of 3 bookings. 1 failed. Press Sync again.'
  );
  assert.equal(
    buildGoogleSheetBookingSyncMessage({
      totalBookingCount: 3,
      syncedBookingCount: 2,
      failedBookingCount: 1,
      failureReasons: ['unauthorized'],
    }),
    'Synced 2 of 3 bookings. 1 failed. Reason: unauthorized. Press Sync again.'
  );
});

test('buildGoogleSheetBookingSyncFailureMessage explains the deployment and secret failures', () => {
  assert.match(
    buildGoogleSheetBookingSyncFailureMessage(['delivery_metadata_missing']),
    /does not understand the booking sync request.*deploy a new version/i
  );
  assert.match(
    buildGoogleSheetBookingSyncFailureMessage(['unauthorized']),
    /APPS_SCRIPT_SHARED_SECRET.*SHARED_SECRET/i
  );
  assert.match(
    buildGoogleSheetBookingSyncFailureMessage([
      'APPS_SCRIPT_RESPONSE_NOT_JSON',
    ]),
    /\/exec URL/
  );
  assert.match(
    buildGoogleSheetBookingSyncFailureMessage(['something_unknown']),
    /Check the Apps Script deployment/
  );
  assert.match(
    buildGoogleSheetBookingSyncFailureMessage(['APPS_SCRIPT_HTTP_404']),
    /HTTP 404.*deployment URL/
  );
});
