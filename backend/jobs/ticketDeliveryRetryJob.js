import {
  fetchFailedTicketDeliveryRecordsBelowMaxAttempts,
  isTicketEmailDeliveryEnabled,
  resolveTicketDeliveryMaxAttempts,
  redeliverFailedTicketEmail,
} from '../services/ticketDeliveryService.js';

import {
  fetchPaymentReceiptsAwaitingDelivery,
  deliverPaymentReceiptEmailToAttendee,
} from '../services/paymentReceiptService.js';

const DEFAULT_TICKET_EMAIL_RETRIES_PER_RUN = 5;

// One scheduler run must never turn into a burst that trips Gmail's hourly
// limit. A malformed or negative value falls back to the safe default instead
// of silently disabling retries (slice(0, NaN) would return no rows at all).
export function resolveTicketEmailRetryLimitPerRun() {
  const configuredLimit = Number(process.env.TICKET_EMAIL_MAX_RETRIES_PER_RUN);

  if (!Number.isFinite(configuredLimit) || configuredLimit <= 0) {
    return DEFAULT_TICKET_EMAIL_RETRIES_PER_RUN;
  }

  return Math.floor(configuredLimit);
}

export async function runTicketDeliveryRetryJob(options = {}) {
  // A no-email deployment has no ticket or receipt email to retry. Returning
  // early also covers rows left failed by an earlier configuration.
  if (!isTicketEmailDeliveryEnabled()) {
    return [];
  }

  const maxAttempts = options.maxAttempts ?? resolveTicketDeliveryMaxAttempts();
  const maxPerRun = options.maxPerRun ?? resolveTicketEmailRetryLimitPerRun();
  const retryTicketDelivery =
    options.retryTicketDelivery ?? redeliverFailedTicketEmail;
  const deliverReceiptEmail =
    options.deliverReceiptEmail ?? deliverPaymentReceiptEmailToAttendee;

  const ticketRetryOutcomes = await retryFailedTicketDeliveries(
    maxAttempts,
    retryTicketDelivery,
    maxPerRun
  );
  const receiptRetryOutcomes = await retryPaymentReceiptDeliveries(
    maxAttempts,
    deliverReceiptEmail,
    maxPerRun
  );

  return [...ticketRetryOutcomes, ...receiptRetryOutcomes];
}

export async function retryFailedTicketDeliveries(
  maxAttempts,
  retryTicketDelivery = redeliverFailedTicketEmail,
  maxPerRun = DEFAULT_TICKET_EMAIL_RETRIES_PER_RUN
) {
  const failedDeliveryRecords = await fetchFailedTicketDeliveryRecordsBelowMaxAttempts(
    maxAttempts
  );
  const retryableDeliveryRecords = failedDeliveryRecords.slice(0, maxPerRun);

  const ticketRetryOutcomes = [];

  for (const failedDeliveryRecord of retryableDeliveryRecords) {
    const deliveryOutcome = await retryTicketDelivery(failedDeliveryRecord.booking_id);

    ticketRetryOutcomes.push({
      target: 'ticket',
      bookingId: failedDeliveryRecord.booking_id,
      deliveryId: failedDeliveryRecord.id,
      attemptCountBeforeRetry: failedDeliveryRecord.attempt_count,
      delivered: deliveryOutcome?.delivered === true,
      reason: deliveryOutcome?.reason ?? null,
    });
  }

  return ticketRetryOutcomes;
}

export async function retryPaymentReceiptDeliveries(
  maxAttempts,
  deliverReceiptEmail = deliverPaymentReceiptEmailToAttendee,
  maxPerRun = DEFAULT_TICKET_EMAIL_RETRIES_PER_RUN
) {
  const receiptsAwaitingDelivery = await fetchPaymentReceiptsAwaitingDelivery();
  const retryableReceiptRecords = receiptsAwaitingDelivery
    .filter((receiptRecord) => receiptRecord.attemptCount < maxAttempts)
    .slice(0, maxPerRun);

  const receiptRetryOutcomes = [];

  for (const receiptRecord of retryableReceiptRecords) {
    try {
      const receiptDeliveryResult = await deliverReceiptEmail(
        receiptRecord.bookingId,
        { receiptRecord }
      );

      receiptRetryOutcomes.push({
        target: 'receipt',
        bookingId: receiptRecord.bookingId,
        receiptId: receiptRecord.id,
        attemptCountBeforeRetry: receiptRecord.attemptCount,
        delivered: receiptDeliveryResult?.delivered === true,
        reason: null,
      });
    } catch (error) {
      receiptRetryOutcomes.push({
        target: 'receipt',
        bookingId: receiptRecord.bookingId,
        receiptId: receiptRecord.id,
        attemptCountBeforeRetry: receiptRecord.attemptCount,
        delivered: false,
        reason: error.message || 'Unknown receipt email delivery error',
      });
    }
  }

  return receiptRetryOutcomes;
}
