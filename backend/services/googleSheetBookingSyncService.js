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
      const failureReasonCode =
        error instanceof AppsScriptWebhookError
          ? error.errorCode
          : 'GOOGLE_SHEET_BATCH_FAILED';

      console.error('google_sheet_booking_sync_batch_failed', {
        bookingCount: bookingBatch.length,
        failureReasonCode,
      });

      syncSummary.failedBatchCount += 1;
      syncSummary.failedBookingCount += bookingBatch.length;
      syncSummary.failureReasons.push(failureReasonCode);
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
    const failureReasonSuffix =
      Array.isArray(syncSummary.failureReasons) &&
      syncSummary.failureReasons.length > 0
        ? ` Reason: ${syncSummary.failureReasons.join(', ')}.`
        : '';

    return (
      `Synced ${syncSummary.syncedBookingCount} of ` +
      `${syncSummary.totalBookingCount} bookings. ` +
      `${syncSummary.failedBookingCount} failed.` +
      failureReasonSuffix +
      ' Press Sync again.'
    );
  }

  return (
    `Synced ${syncSummary.syncedBookingCount} booking` +
    `${syncSummary.syncedBookingCount === 1 ? '' : 's'} to Google Sheets.`
  );
}

const GOOGLE_SHEET_SYNC_FAILURE_MESSAGE_BY_REASON = {
  delivery_metadata_missing:
    'The Apps Script deployment does not understand the booking sync request. Paste the updated apps-script/Code.gs into the Apps Script editor and deploy a new version.',
  invalid_request:
    'The Apps Script deployment rejected the booking sync request. Paste the updated apps-script/Code.gs and deploy a new version.',
  unauthorized:
    'Apps Script rejected the shared secret. Make APPS_SCRIPT_SHARED_SECRET match the SHARED_SECRET script property exactly.',
  apps_script_secret_not_configured:
    'Add the SHARED_SECRET script property in Apps Script → Project Settings → Script Properties.',
  spreadsheet_not_available:
    'The Apps Script is not bound to the Google Sheet. Create it from Extensions → Apps Script inside the Sheet.',
  APPS_SCRIPT_RESPONSE_NOT_JSON:
    'Apps Script did not return JSON. Redeploy with Who has access: Anyone and use the /exec URL, not the /dev URL.',
  APPS_SCRIPT_REQUEST_TIMED_OUT:
    'Apps Script did not answer in time. Retry; if it keeps happening, raise APPS_SCRIPT_REQUEST_TIMEOUT_MS.',
  APPS_SCRIPT_REQUEST_FAILED:
    'The server could not reach Apps Script. Check APPS_SCRIPT_TICKET_WEBHOOK_URL and the deployment status.',
  script_busy:
    'Another Apps Script request is running. Wait a few seconds and press Sync again.',
  booking_batch_too_large:
    'The sync batch is too large. Set GOOGLE_SHEET_SYNC_BATCH_SIZE to 500 or less.',
  booking_reference_missing:
    'A booking has no reference code. Check the booking record in the database.',
  internal_error:
    'Apps Script failed internally. Open Extensions → Apps Script → Executions to see the exact error.',
};

export function buildGoogleSheetBookingSyncFailureMessage(
  failureReasonCodes = []
) {
  const primaryFailureReasonCode = failureReasonCodes[0] || '';

  if (primaryFailureReasonCode === 'APPS_SCRIPT_HTTP_401') {
    return (
      'Google requires a sign-in for this Apps Script URL. Use the deployment URL that ends in /exec (not /dev), and set Who has access to Anyone (anonymous), not Anyone with a Google account. Then deploy a new version.'
    );
  }

  if (primaryFailureReasonCode === 'APPS_SCRIPT_HTTP_403') {
    return (
      'Google refused access to the Apps Script deployment. Confirm Who has access is Anyone (anonymous) and that a Google Workspace policy is not blocking anonymous web apps.'
    );
  }

  if (primaryFailureReasonCode === 'APPS_SCRIPT_HTTP_404') {
    return (
      'The Apps Script deployment URL was not found. Open Deploy → Manage deployments, copy the current /exec URL, and update APPS_SCRIPT_TICKET_WEBHOOK_URL.'
    );
  }

  if (primaryFailureReasonCode.startsWith('APPS_SCRIPT_HTTP_')) {
    const httpStatusCode = primaryFailureReasonCode.replace(
      'APPS_SCRIPT_HTTP_',
      ''
    );

    return (
      `Google returned HTTP ${httpStatusCode} when the server called Apps Script. ` +
      'Check the deployment URL and access setting, then retry.'
    );
  }

  return (
    GOOGLE_SHEET_SYNC_FAILURE_MESSAGE_BY_REASON[primaryFailureReasonCode] ||
    'Google Sheets sync failed. Check the Apps Script deployment and try again.'
  );
}

