// Mirrors the PostgreSQL booking list into the "Bookings" tab of the Google
// Sheet. This is deliberately separate from ticket delivery: a booking that was
// confirmed before email delivery existed, or one whose email failed, still has
// to appear in the Sheet. The sync upserts by booking reference, so pressing the
// admin button repeatedly is safe and never duplicates a row.

import { fetchAdminBookingList } from './adminBookingService.js';

import {
  AppsScriptWebhookError,
  postJsonRequestToAppsScriptWebApp,
  resolveAppsScriptWebhookConfiguration,
} from './appsScriptWebhookClientService.js';

import {
  CRYPTO_CURRENCY_CODE,
  LOCAL_CURRENCY_CODE,
  PAYMENT_METHOD_USDT_BEP20,
} from './eventConfigService.js';

export const DEFAULT_GOOGLE_SHEET_SYNC_BATCH_SIZE = 200;
export const MAXIMUM_GOOGLE_SHEET_SYNC_BATCH_SIZE = 500;

export class GoogleSheetBookingSyncError extends Error {
  constructor(message, syncSummary) {
    super(message);
    this.name = 'GoogleSheetBookingSyncError';
    this.code = 'GOOGLE_SHEET_BOOKING_SYNC_FAILED';
    this.syncSummary = syncSummary;
  }
}

export function resolveGoogleSheetSyncBatchSize() {
  const configuredBatchSize = Number(process.env.GOOGLE_SHEET_SYNC_BATCH_SIZE);

  if (!Number.isFinite(configuredBatchSize) || configuredBatchSize < 1) {
    return DEFAULT_GOOGLE_SHEET_SYNC_BATCH_SIZE;
  }

  return Math.min(
    Math.floor(configuredBatchSize),
    MAXIMUM_GOOGLE_SHEET_SYNC_BATCH_SIZE
  );
}

function toIsoTimestampString(timestampValue) {
  if (!timestampValue) {
    return '';
  }

  const parsedDate = new Date(timestampValue);

  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString();
}

function resolveCurrencyCodeForPaymentMethod(paymentMethod) {
  return paymentMethod === PAYMENT_METHOD_USDT_BEP20
    ? CRYPTO_CURRENCY_CODE
    : LOCAL_CURRENCY_CODE;
}

export function buildBookingMirrorRecordForSheet(bookingRow) {
  const parsedPaymentAmount = Number(bookingRow.amount_expected);
  const paymentAmount =
    bookingRow.amount_expected == null || bookingRow.amount_expected === ''
      ? ''
      : Number.isFinite(parsedPaymentAmount)
        ? parsedPaymentAmount
        : '';

  return {
    bookingReference: String(bookingRow.ref ?? ''),
    attendeeName: String(bookingRow.full_name ?? ''),
    emailAddress: String(bookingRow.email ?? ''),
    phoneNumber: String(bookingRow.phone_number ?? ''),
    bookingStatus: String(bookingRow.status ?? ''),
    paymentStatus: String(bookingRow.payment_status ?? ''),
    paymentMethod: String(bookingRow.payment_method ?? ''),
    paymentAmount,
    paymentCurrency: resolveCurrencyCodeForPaymentMethod(bookingRow.payment_method),
    referrerName: String(bookingRow.referrer_name || bookingRow.utm_source || ''),
    ticketSentAt: toIsoTimestampString(bookingRow.ticket_sent_at),
    bookingCreatedAt: toIsoTimestampString(bookingRow.created_at),
  };
}

export function splitBookingsIntoBatches(bookingRows, batchSize) {
  const bookingBatches = [];

  for (
    let batchStartIndex = 0;
    batchStartIndex < bookingRows.length;
    batchStartIndex += batchSize
  ) {
    bookingBatches.push(
      bookingRows.slice(batchStartIndex, batchStartIndex + batchSize)
    );
  }

  return bookingBatches;
}

export async function syncAllBookingsToGoogleSheet(options = {}) {
  // Fail before reading 500 rows when the webhook is not configured.
  const webhookConfiguration = resolveAppsScriptWebhookConfiguration();
  const fetchBookingRows = options.fetchBookingRows ?? fetchAdminBookingList;
  const postRequest =
    options.postRequest ?? postJsonRequestToAppsScriptWebApp;
  const batchSize = Math.max(
    1,
    options.batchSize ?? resolveGoogleSheetSyncBatchSize()
  );
  const bookingRows = await fetchBookingRows({});
  const bookingBatches = splitBookingsIntoBatches(bookingRows, batchSize);
  const syncedAt = new Date().toISOString();

  const syncSummary = {
    totalBookingCount: bookingRows.length,
    syncedBookingCount: 0,
    createdBookingCount: 0,
    updatedBookingCount: 0,
    failedBookingCount: 0,
    batchCount: bookingBatches.length,
    failedBatchCount: 0,
    failureReasons: [],
  };

  for (const bookingBatch of bookingBatches) {
    try {
      const responseBody = await postRequest(
        {
          requestType: 'sync_bookings',
          syncedAt,
          bookings: bookingBatch.map(buildBookingMirrorRecordForSheet),
        },
        { configuration: webhookConfiguration }
      );

      syncSummary.syncedBookingCount += Number(responseBody.syncedCount) || 0;
      syncSummary.createdBookingCount += Number(responseBody.createdCount) || 0;
      syncSummary.updatedBookingCount += Number(responseBody.updatedCount) || 0;
    } catch (error) {
      syncSummary.failedBatchCount += 1;
      syncSummary.failedBookingCount += bookingBatch.length;
      syncSummary.failureReasons.push(
        error instanceof AppsScriptWebhookError
          ? error.errorCode
          : 'GOOGLE_SHEET_BATCH_FAILED'
      );
    }
  }

  syncSummary.failureReasons = [...new Set(syncSummary.failureReasons)];

  if (
    syncSummary.failedBookingCount > 0 &&
    syncSummary.syncedBookingCount === 0
  ) {
    throw new GoogleSheetBookingSyncError(
      'Every booking batch failed to sync to Google Sheets',
      syncSummary
    );
  }

  return syncSummary;
}

export function buildGoogleSheetBookingSyncMessage(syncSummary) {
  if (syncSummary.totalBookingCount === 0) {
    return 'There are no bookings to sync yet.';
  }

  if (syncSummary.failedBookingCount > 0) {
    return (
      `Synced ${syncSummary.syncedBookingCount} of ` +
      `${syncSummary.totalBookingCount} bookings. ` +
      `${syncSummary.failedBookingCount} failed; press Sync again.`
    );
  }

  return (
    `Synced ${syncSummary.syncedBookingCount} booking` +
    `${syncSummary.syncedBookingCount === 1 ? '' : 's'} to Google Sheets.`
  );
}

