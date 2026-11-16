import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
} from '../services/paymentService.js';
import {
  createOrderWithDepositAddressForBooking,
  fetchDepositAddressRecordsForOrderId,
} from '../services/orderService.js';
import {
  confirmUsdtOrderPaymentFromObservedDeposits,
  evaluateBookingHoldExpiryForConfirmation,
} from '../services/usdtPaymentService.js';
import { fetchPaymentReceiptByBookingId } from '../services/paymentReceiptService.js';
import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';
import { TICKET_PRICE_USDT } from '../services/eventConfigService.js';

const PAYER_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const SETTLEMENT_FRONTIER = {
  latestBlockNumber: 1000,
  finalizedBlockNumber: 1000,
  settledBy: 'finalized',
};
const CHANGE_WITHOUT_SEAT_REVIEW_REASONS = [
  'overpayment',
  'hold_expired_with_seat',
];

let reviewFlagBookingCounter = 0;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  reviewFlagBookingCounter = 0;
}

beforeEach(resetDatabaseState);

async function createPendingCryptoBooking() {
  reviewFlagBookingCounter += 1;
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: `Review Flag ${reviewFlagBookingCounter}`,
    email: `review-flag-${reviewFlagBookingCounter}@example.com`,
    phone_number: `+255712348${String(100 + reviewFlagBookingCounter).padStart(3, '0')}`,
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  const depositAddressRecords = await fetchDepositAddressRecordsForOrderId(createdOrder.id);
  const activeDepositAddress = depositAddressRecords.find((record) => record.is_active);

  return { bookingRecord, paymentRecord, createdOrder, activeDepositAddress };
}

async function recordObservedDeposit({
  depositAddressRecord,
  orderId,
  amountUsdt,
  blockNumber,
  txHash,
}) {
  const insertResult = await pool.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id, confirmations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     RETURNING id`,
    [
      depositAddressRecord.address,
      txHash,
      PAYER_ADDRESS,
      amountUsdt,
      ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
      blockNumber,
      `0xblock${blockNumber}`,
      orderId,
    ]
  );
  return {
    id: Number(insertResult.rows[0].id),
    order_id: orderId,
    amount: Number(amountUsdt),
    amount_usdt: String(amountUsdt),
    amount_wei: ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
    block_number: blockNumber,
    block_hash: `0xblock${blockNumber}`,
    tx_hash: txHash,
    from_address: PAYER_ADDRESS,
    address: depositAddressRecord.address,
    is_finalized: false,
  };
}

function buildSuccessfulDeliveryStub() {
  return async () => ({ delivered: true, receipt: { delivered: true } });
}

async function confirmObservedDepositPayment({
  bookingRecord,
  createdOrder,
  activeDepositAddress,
  amountUsdt = TICKET_PRICE_USDT,
  txHash,
  blockNumber = 990,
}) {
  const observedDeposit = await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt,
    blockNumber,
    txHash,
  });
  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);

  const confirmationResult = await confirmUsdtOrderPaymentFromObservedDeposits({
    orderId: createdOrder.id,
    bookingId: bookingRecord.id,
    paymentId: paymentRecord.id,
    depositAddress: activeDepositAddress.address,
    observedDeposits: [observedDeposit],
    settlementFrontier: SETTLEMENT_FRONTIER,
    chainId: 97,
    deliverTicket: buildSuccessfulDeliveryStub(),
    deliverReceiptEmail: buildSuccessfulDeliveryStub(),
  });

  return { confirmationResult, paymentRecord, observedDeposit };
}

async function fetchReviewFlagsForOrder(orderId) {
  const result = await pool.query(
    'SELECT * FROM payment_review_flags WHERE order_id = $1 ORDER BY id ASC',
    [orderId]
  );
  return result.rows;
}

test('an overpayment confirms the booking and records the surplus for review', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();

  const { confirmationResult } = await confirmObservedDepositPayment({
    bookingRecord,
    createdOrder,
    activeDepositAddress,
    amountUsdt: 5,
    txHash: '0xoverpaymentdeposit0001',
  });

  assert.equal(confirmationResult.confirmed, true);
  assert.equal(confirmationResult.seatConfirmed, true);

  const reviewFlags = await fetchReviewFlagsForOrder(createdOrder.id);
  const overpaymentFlag = reviewFlags.find((flagRow) => flagRow.reason === 'overpayment');
  assert.ok(overpaymentFlag, 'the surplus is not silently swept');
  assert.equal(Number(overpaymentFlag.amount), 5);
  assert.equal(overpaymentFlag.auto_action, 'review_required');
  assert.equal(Number(overpaymentFlag.details.expectedAmountUsdt), TICKET_PRICE_USDT);
  assert.equal(Number(overpaymentFlag.details.overpaidAmountUsdt), 1.2);
});

test('a payment confirmed after the hold expired still records that the seat was granted late', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
  await pool.query(
    `UPDATE orders SET expires_at = now() - INTERVAL '2 hours' WHERE id = $1`,
    [createdOrder.id]
  );
  await pool.query(
    `UPDATE bookings SET expires_at = now() - INTERVAL '2 hours' WHERE id = $1`,
    [bookingRecord.id]
  );

  const { confirmationResult } = await confirmObservedDepositPayment({
    bookingRecord,
    createdOrder,
    activeDepositAddress,
    txHash: '0xlateholddeposit0001',
  });

  assert.equal(confirmationResult.confirmed, true);
  assert.equal(confirmationResult.seatConfirmed, true);

  const reviewFlags = await fetchReviewFlagsForOrder(createdOrder.id);
  const lateHoldFlag = reviewFlags.find((flagRow) => flagRow.reason === 'hold_expired_with_seat');
  assert.ok(lateHoldFlag, 'the late seat grant is preserved as a review fact');
  assert.equal(lateHoldFlag.auto_action, 'review_required');
  assert.equal(lateHoldFlag.details.bookingStatusAtConfirmation, 'pending');
});

test('a normal on-time exact payment produces none of the confirmation review flags', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();

  const { confirmationResult } = await confirmObservedDepositPayment({
    bookingRecord,
    createdOrder,
    activeDepositAddress,
    txHash: '0xnormalexactpayment0001',
  });

  assert.equal(confirmationResult.confirmed, true);
  assert.equal(confirmationResult.seatConfirmed, true);

  const reviewFlags = await fetchReviewFlagsForOrder(createdOrder.id);
  const unexpectedFlags = reviewFlags.filter((flagRow) =>
    CHANGE_WITHOUT_SEAT_REVIEW_REASONS.includes(flagRow.reason)
  );
  assert.deepEqual(unexpectedFlags, []);
});

test('the hold expiration evaluator treats either expired timestamp or an expired booking as late', () => {
  const now = new Date('2026-01-03T00:00:00.000Z');

  const onTime = evaluateBookingHoldExpiryForConfirmation({
    bookingRecord: {
      status: 'pending',
      expires_at: '2026-01-03T01:00:00.000Z',
    },
    orderRecord: {
      expires_at: '2026-01-03T01:00:00.000Z',
    },
    now,
  });
  assert.equal(onTime.holdExpired, false);

  const expiredBookingStatus = evaluateBookingHoldExpiryForConfirmation({
    bookingRecord: {
      status: 'expired',
      expires_at: '2026-01-03T01:00:00.000Z',
    },
    orderRecord: {
      expires_at: '2026-01-03T01:00:00.000Z',
    },
    now,
  });
  assert.equal(expiredBookingStatus.holdExpired, true);

  const expiredOrderTimestamp = evaluateBookingHoldExpiryForConfirmation({
    bookingRecord: {
      status: 'pending',
      expires_at: '2026-01-03T01:00:00.000Z',
    },
    orderRecord: {
      expires_at: '2026-01-02T23:00:00.000Z',
    },
    now,
  });
  assert.equal(expiredOrderTimestamp.holdExpired, true);
});
