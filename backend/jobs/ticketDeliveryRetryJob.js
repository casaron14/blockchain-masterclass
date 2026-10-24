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

export async function runTicketDeliveryRetryJob(options = {}) {
  // A no-email deployment has no ticket or receipt email to retry. Returning
  // early also covers rows left failed by an earlier configuration.
  if (!isTicketEmailDeliveryEnabled()) {
    return [];
  }

  const maxAttempts = options.maxAttempts ?? resolveTicketDeliveryMaxAttempts();
  const retryTicketDelivery =
    options.retryTicketDelivery ?? redeliverFailedTicketEmail;
  const deliverReceiptEmail =
    options.deliverReceiptEmail ?? deliverPaymentReceiptEmailToAttendee;

  const ticketRetryOutcomes = await retryFailedTicketDeliveries(
    maxAttempts,
    retryTicketDelivery
  );
  const receiptRetryOutcomes = await retryPaymentReceiptDeliveries(
    maxAttempts,
    deliverReceiptEmail
  );

  return [...ticketRetryOutcomes, ...receiptRetryOutcomes];
}

export async function retryFailedTicketDeliveries(
  maxAttempts,
  retryTicketDelivery = redeliverFailedTicketEmail
) {
  const failedDeliveryRecords = await fetchFailedTicketDeliveryRecordsBelowMaxAttempts(
    maxAttempts
  );

  const ticketRetryOutcomes = [];

  for (const failedDeliveryRecord of failedDeliveryRecords) {
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
  deliverReceiptEmail = deliverPaymentReceiptEmailToAttendee
) {
  const receiptsAwaitingDelivery = await fetchPaymentReceiptsAwaitingDelivery();
  const retryableReceiptRecords = receiptsAwaitingDelivery.filter(
    (receiptRecord) => receiptRecord.attemptCount < maxAttempts
  );

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
