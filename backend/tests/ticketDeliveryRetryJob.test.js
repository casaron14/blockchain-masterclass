import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import { runTicketDeliveryRetryJob } from '../jobs/ticketDeliveryRetryJob.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
} from '../services/bookingService.js';

import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';

import {
  createPaymentReceiptRecordForConfirmedPayment,
  markPaymentReceiptFailed,
  fetchPaymentReceiptByBookingId,
} from '../services/paymentReceiptService.js';

const DEFAULT_TICKET_DELIVERY_MAX_ATTEMPTS = 5;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createConfirmedBooking() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Retry User',
    email: 'retry@example.com',
    phone_number: '+255712345700',
  });
  return confirmBookingSeatWithinCapacity(bookingRecord.id);
}

async function recordFailedTicketDeliveryForBooking(bookingId, attemptCount) {
  await pool.query(
    `INSERT INTO ticket_deliveries (booking_id, status, attempt_count, last_error)
     VALUES ($1, 'failed', $2, 'SMTP refused connection')`,
    [bookingId, attemptCount]
  );
}

async function fetchTicketDeliveryRecordForBooking(bookingId) {
  const fetchResult = await pool.query(
    'SELECT * FROM ticket_deliveries WHERE booking_id = $1',
    [bookingId]
  );
  return fetchResult.rows[0] ?? null;
}

async function createPendingPaymentReceiptForBooking(bookingId) {
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingId,
    'usdt_bep20'
  );
  await pool.query(
    `UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
    [paymentRecord.id]
  );

  const orderCreation = await createOrderWithDepositAddressForBooking(bookingId);
  const bookingRecord = await pool.query('SELECT * FROM bookings WHERE id = $1', [
    bookingId,
  ]);
  const orderRecord = await pool.query('SELECT * FROM orders WHERE id = $1', [
    orderCreation.id,
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord: { ...paymentRecord, status: 'confirmed' },
      bookingRecord: bookingRecord.rows[0],
      orderRecord: orderRecord.rows[0],
      depositAddress: orderCreation.deposit_address,
      observedDeposits: [
        {
          tx_hash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          from_address: '0x2222222222222222222222222222222222222222',
          amount: '3.80',
          amount_wei: '3800000000000000000',
          block_number: 200,
          block_hash: '0xblockhash200',
        },
      ],
      settlementSummary: {
        finalizedBlockNumber: 210,
        confirmationsAtIssue: 11,
        chainId: 56,
      },
    });
    await client.query('COMMIT');
    return receiptRecord;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

test('runTicketDeliveryRetryJob retries a failed ticket delivery and flips it to sent', async () => {
  const confirmedBooking = await createConfirmedBooking();
  await recordFailedTicketDeliveryForBooking(confirmedBooking.id, 1);

  const retriedBookingIds = [];
  const retrySummary = await runTicketDeliveryRetryJob({
    retryTicketDelivery: async (bookingId) => {
      retriedBookingIds.push(bookingId);
      await pool.query(
        `UPDATE ticket_deliveries
            SET status = 'sent', sent_at = now(), last_error = NULL,
                attempt_count = attempt_count + 1
          WHERE booking_id = $1`,
        [bookingId]
      );
      return { delivered: true, bookingId };
    },
  });

  assert.deepEqual(retriedBookingIds, [confirmedBooking.id]);
  assert.equal(retrySummary.length, 1);
  assert.equal(retrySummary[0].target, 'ticket');
  assert.equal(retrySummary[0].bookingId, confirmedBooking.id);
  assert.equal(retrySummary[0].attemptCountBeforeRetry, 1);
  assert.equal(retrySummary[0].delivered, true);
  assert.equal(retrySummary[0].reason, null);

  const deliveryRecord = await fetchTicketDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(deliveryRecord.status, 'sent');
  assert.equal(deliveryRecord.attempt_count, 2);
});

test('runTicketDeliveryRetryJob stops retrying a failed ticket delivery at the max attempt count', async () => {
  const confirmedBooking = await createConfirmedBooking();
  await recordFailedTicketDeliveryForBooking(
    confirmedBooking.id,
    DEFAULT_TICKET_DELIVERY_MAX_ATTEMPTS
  );

  const retriedBookingIds = [];
  const retrySummary = await runTicketDeliveryRetryJob({
    retryTicketDelivery: async (bookingId) => {
      retriedBookingIds.push(bookingId);
      return { delivered: true, bookingId };
    },
  });

  assert.deepEqual(retriedBookingIds, []);
  assert.deepEqual(retrySummary, []);

  const deliveryRecord = await fetchTicketDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(deliveryRecord.status, 'failed');
  assert.equal(deliveryRecord.attempt_count, DEFAULT_TICKET_DELIVERY_MAX_ATTEMPTS);
});

test('runTicketDeliveryRetryJob leaves a sent ticket delivery alone', async () => {
  const confirmedBooking = await createConfirmedBooking();
  await pool.query(
    `INSERT INTO ticket_deliveries (booking_id, status, attempt_count, sent_at)
     VALUES ($1, 'sent', 1, now())`,
    [confirmedBooking.id]
  );

  const retriedBookingIds = [];
  const retrySummary = await runTicketDeliveryRetryJob({
    retryTicketDelivery: async (bookingId) => {
      retriedBookingIds.push(bookingId);
      return { delivered: true, bookingId };
    },
  });

  assert.deepEqual(retriedBookingIds, []);
  assert.deepEqual(retrySummary, []);

  const deliveryRecord = await fetchTicketDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(deliveryRecord.status, 'sent');
  assert.equal(deliveryRecord.attempt_count, 1);
});

test('runTicketDeliveryRetryJob re-runs receipt delivery for a pending receipt', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const pendingReceipt = await createPendingPaymentReceiptForBooking(
    confirmedBooking.id
  );

  const deliveredReceiptBookingIds = [];
  const retrySummary = await runTicketDeliveryRetryJob({
    retryTicketDelivery: async () => {
      throw new Error('no failed ticket delivery should be retried in this test');
    },
    deliverReceiptEmail: async (bookingId, options) => {
      deliveredReceiptBookingIds.push(bookingId);
      return { delivered: true, receiptId: options.receiptRecord.id };
    },
  });

  assert.deepEqual(
    deliveredReceiptBookingIds,
    [Number(confirmedBooking.id)]
  );
  assert.equal(retrySummary.length, 1);
  assert.equal(retrySummary[0].target, 'receipt');
  assert.equal(retrySummary[0].receiptId, pendingReceipt.id);
  assert.equal(retrySummary[0].attemptCountBeforeRetry, 0);
  assert.equal(retrySummary[0].delivered, true);

  const receiptAfterRetry = await fetchPaymentReceiptByBookingId(confirmedBooking.id);
  assert.equal(receiptAfterRetry.status, 'pending');
});

test('runTicketDeliveryRetryJob retries a failed receipt and records the failure reason', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const failedReceipt = await createPendingPaymentReceiptForBooking(
    confirmedBooking.id
  );
  await markPaymentReceiptFailed(failedReceipt.id, 'SMTP refused connection');

  const retrySummary = await runTicketDeliveryRetryJob({
    deliverReceiptEmail: async () => {
      throw new Error('SMTP refused connection again');
    },
  });

  assert.equal(retrySummary.length, 1);
  assert.equal(retrySummary[0].target, 'receipt');
  assert.equal(retrySummary[0].receiptId, failedReceipt.id);
  assert.equal(retrySummary[0].attemptCountBeforeRetry, 1);
  assert.equal(retrySummary[0].delivered, false);
  assert.equal(retrySummary[0].reason, 'SMTP refused connection again');

  const receiptAfterRetry = await fetchPaymentReceiptByBookingId(confirmedBooking.id);
  assert.equal(receiptAfterRetry.status, 'failed');
  assert.equal(receiptAfterRetry.attemptCount, 1);
});

test('runTicketDeliveryRetryJob stops retrying a receipt at the max attempt count', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const failedReceipt = await createPendingPaymentReceiptForBooking(
    confirmedBooking.id
  );
  await pool.query(
    `UPDATE payment_receipts
        SET status = 'failed', attempt_count = $2, last_error = 'SMTP refused connection'
      WHERE id = $1`,
    [failedReceipt.id, DEFAULT_TICKET_DELIVERY_MAX_ATTEMPTS]
  );

  const deliveredReceiptBookingIds = [];
  const retrySummary = await runTicketDeliveryRetryJob({
    deliverReceiptEmail: async (bookingId) => {
      deliveredReceiptBookingIds.push(bookingId);
      return { delivered: true };
    },
  });

  assert.deepEqual(deliveredReceiptBookingIds, []);
  assert.deepEqual(retrySummary, []);

  const receiptAfterRetry = await fetchPaymentReceiptByBookingId(confirmedBooking.id);
  assert.equal(receiptAfterRetry.status, 'failed');
  assert.equal(receiptAfterRetry.attemptCount, DEFAULT_TICKET_DELIVERY_MAX_ATTEMPTS);
});

test('runTicketDeliveryRetryJob sends nothing when email delivery is disabled', async () => {
  const confirmedBooking = await createConfirmedBooking();
  await recordFailedTicketDeliveryForBooking(confirmedBooking.id, 1);

  const previousDeliveryFlag = process.env.EMAIL_DELIVERY_ENABLED;
  process.env.EMAIL_DELIVERY_ENABLED = 'false';

  try {
    let anyEmailWasSent = false;
    const retrySummary = await runTicketDeliveryRetryJob({
      retryTicketDelivery: async () => {
        anyEmailWasSent = true;
        return { delivered: true };
      },
      deliverReceiptEmail: async () => {
        anyEmailWasSent = true;
        return { delivered: true };
      },
    });

    assert.deepEqual(retrySummary, []);
    assert.equal(anyEmailWasSent, false);

    const deliveryRecord = await fetchTicketDeliveryRecordForBooking(confirmedBooking.id);
    assert.equal(deliveryRecord.status, 'failed');
    assert.equal(deliveryRecord.attempt_count, 1);
  } finally {
    if (previousDeliveryFlag === undefined) {
      delete process.env.EMAIL_DELIVERY_ENABLED;
    } else {
      process.env.EMAIL_DELIVERY_ENABLED = previousDeliveryFlag;
    }
  }
});

test('runTicketDeliveryRetryJob is safe to call repeatedly with nothing left to retry', async () => {
  const confirmedBooking = await createConfirmedBooking();
  await createPendingPaymentReceiptForBooking(confirmedBooking.id);

  const firstRunSummary = await runTicketDeliveryRetryJob({
    deliverReceiptEmail: async (bookingId, options) => {
      await pool.query(
        `UPDATE payment_receipts
            SET status = 'issued', issued_at = now(), attempt_count = attempt_count + 1
          WHERE id = $1`,
        [options.receiptRecord.id]
      );
      return { delivered: true, receiptId: options.receiptRecord.id };
    },
  });

  assert.equal(firstRunSummary.length, 1);
  assert.equal(firstRunSummary[0].delivered, true);

  const secondRunSummary = await runTicketDeliveryRetryJob({
    deliverReceiptEmail: async () => {
      throw new Error('an issued receipt must not be delivered again');
    },
  });

  assert.deepEqual(secondRunSummary, []);

  const receiptAfterSecondRun = await fetchPaymentReceiptByBookingId(confirmedBooking.id);
  assert.equal(receiptAfterSecondRun.status, 'issued');
  assert.equal(receiptAfterSecondRun.attemptCount, 1);
});
