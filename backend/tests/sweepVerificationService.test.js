import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  verifyPaymentAgainstSweepEvidence,
  fetchAmbiguousUnconfirmedPaymentRecords,
  PAYMENT_VERIFIED_FROM_OBSERVED_DEPOSITS,
  PAYMENT_VERIFIED_FROM_SWEEP_EVIDENCE_ONLY,
  PAYMENT_NOT_FOUND_IN_EVIDENCE,
  PAYMENT_EVIDENCE_BELOW_EXPECTED,
} from '../services/sweepVerificationService.js';

import {
  createOrderWithDepositAddressForBooking,
  updateOrderStatus,
} from '../services/orderService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

import {
  createPendingPaymentRecordForBooking,
} from '../services/paymentService.js';

import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

const TICKET_PRICE_USDT = 3.8;
const TICKET_PRICE_WEI = ethers.parseUnits(String(TICKET_PRICE_USDT), DEFAULT_USDT_DECIMALS);

let confirmedBookingCounter = 0;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  confirmedBookingCounter = 0;
}

beforeEach(resetDatabaseState);

async function createOrderForUnconfirmedBooking() {
  confirmedBookingCounter += 1;
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: `Sweep Evidence ${confirmedBookingCounter}`,
    email: `evidence${confirmedBookingCounter}@example.com`,
    phone_number: `+2557123456${String(70 + confirmedBookingCounter).padStart(2, '0')}`,
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  return { bookingRecord, createdOrder };
}

async function recordObservedDeposit(orderId, depositAddress, amountUsdt, txHash) {
  await pool.query(
    `INSERT INTO deposits_observed
       (order_id, address, tx_hash, amount, amount_wei, block_number, confirmations, is_finalized)
     VALUES ($1, $2, $3, $4, $5, 1000, 5, true)`,
    [
      orderId,
      depositAddress,
      txHash,
      amountUsdt,
      ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
    ]
  );
}

async function recordSweepRow(
  orderId,
  depositAddress,
  amountUsdt,
  { status = 'swept', txHash = '0xsweeptx1', triggeredBy = 'scheduled' } = {}
) {
  const sweepResult = await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, status, tx_hash, triggered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      orderId,
      depositAddress,
      amountUsdt,
      ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
      status,
      txHash,
      triggeredBy,
    ]
  );
  return sweepResult.rows[0].id;
}

test('verifyPaymentAgainstSweepEvidence proves a payment from an observed deposit that was never swept', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xdeposit1');

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, true);
  assert.equal(verificationResult.reason, PAYMENT_VERIFIED_FROM_OBSERVED_DEPOSITS);
  assert.equal(verificationResult.sweptAmountWei, 0n);
  assert.equal(verificationResult.collectedToTreasury, false);
  assert.deepEqual(verificationResult.sweepRecords, []);
});

test('verifyPaymentAgainstSweepEvidence proves a payment whose deposit was already collected to the treasury', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  const sweepId = await recordSweepRow(
    createdOrder.id,
    createdOrder.deposit_address,
    TICKET_PRICE_USDT,
    { status: 'swept', txHash: '0xcollectedsweeptx' }
  );
  await pool.query(
    `INSERT INTO treasury_ledger (order_id, sweep_id, tx_hash, amount)
     VALUES ($1, $2, $3, $4)`,
    [createdOrder.id, sweepId, '0xcollectedsweeptx', TICKET_PRICE_USDT]
  );

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, true);
  assert.equal(verificationResult.reason, PAYMENT_VERIFIED_FROM_SWEEP_EVIDENCE_ONLY);
  assert.equal(verificationResult.sweptAmountWei, TICKET_PRICE_WEI);
  assert.equal(verificationResult.treasuryLedgerTotalWei, TICKET_PRICE_WEI);
  assert.equal(verificationResult.collectedToTreasury, true);
  assert.equal(verificationResult.sweepRecords.length, 1);
  assert.equal(verificationResult.sweepRecords[0].txHash, '0xcollectedsweeptx');
  assert.equal(verificationResult.sweepRecords[0].status, 'swept');
});

test('verifyPaymentAgainstSweepEvidence does not count an observed deposit twice when it was also swept', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xdeposit1');
  const sweepId = await recordSweepRow(
    createdOrder.id,
    createdOrder.deposit_address,
    TICKET_PRICE_USDT,
    { status: 'swept', txHash: '0xsweptafterobservation' }
  );
  await pool.query(
    `INSERT INTO treasury_ledger (order_id, sweep_id, tx_hash, amount)
     VALUES ($1, $2, $3, $4)`,
    [createdOrder.id, sweepId, '0xsweptafterobservation', TICKET_PRICE_USDT]
  );

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, true);
  assert.equal(verificationResult.observedDepositsTotalWei, TICKET_PRICE_WEI);
  assert.equal(verificationResult.sweptAmountWei, TICKET_PRICE_WEI);
  assert.equal(verificationResult.collectedToTreasury, true);
});

test('verifyPaymentAgainstSweepEvidence rejects a failed sweep row as proof of payment', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await recordSweepRow(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, {
    status: 'failed',
    txHash: '0xfailedsweeptx',
  });

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, false);
  assert.equal(verificationResult.reason, PAYMENT_NOT_FOUND_IN_EVIDENCE);
  assert.deepEqual(verificationResult.sweepRecords, []);
});

test('verifyPaymentAgainstSweepEvidence ignores a successful sweep row that carries no transaction hash', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, status, tx_hash)
     VALUES ($1, $2, $3, $4, 'funded', NULL)`,
    [
      createdOrder.id,
      createdOrder.deposit_address,
      TICKET_PRICE_USDT,
      TICKET_PRICE_WEI.toString(),
    ]
  );

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, false);
  assert.equal(verificationResult.reason, PAYMENT_NOT_FOUND_IN_EVIDENCE);
});

test('verifyPaymentAgainstSweepEvidence rejects evidence that is below the expected amount', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, 1.5, '0xunderdeposit');

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, false);
  assert.equal(verificationResult.reason, PAYMENT_EVIDENCE_BELOW_EXPECTED);
  assert.equal(
    verificationResult.observedDepositsTotalWei,
    ethers.parseUnits('1.5', DEFAULT_USDT_DECIMALS)
  );
});

test('verifyPaymentAgainstSweepEvidence sums split deposits observed on the same address', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, 2, '0xsplitdeposit1');
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, 1.8, '0xsplitdeposit2');

  const verificationResult = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(verificationResult.paid, true);
  assert.equal(verificationResult.observedDepositsTotalWei, TICKET_PRICE_WEI);
});

test('verifyPaymentAgainstSweepEvidence refuses to run without an order, address and expected amount', async () => {
  await assert.rejects(
    verifyPaymentAgainstSweepEvidence({ depositAddress: '0xaddr', expectedAmountWei: 1n }),
    /orderId is required/
  );
  await assert.rejects(
    verifyPaymentAgainstSweepEvidence({ orderId: 1, expectedAmountWei: 1n }),
    /depositAddress is required/
  );
  await assert.rejects(
    verifyPaymentAgainstSweepEvidence({ orderId: 1, depositAddress: '0xaddr' }),
    /expectedAmountWei is required/
  );
});

test('fetchAmbiguousUnconfirmedPaymentRecords lists an unconfirmed payment that was already collected', async () => {
  const { bookingRecord, createdOrder } = await createOrderForUnconfirmedBooking();
  await updateOrderStatus(createdOrder.id, 'paid');
  await recordSweepRow(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, {
    status: 'swept',
    txHash: '0xambiguoussweeptx',
  });

  const ambiguousPayments = await fetchAmbiguousUnconfirmedPaymentRecords();

  assert.equal(ambiguousPayments.length, 1);
  assert.equal(ambiguousPayments[0].paymentId > 0, true);
  assert.equal(ambiguousPayments[0].bookingId, Number(bookingRecord.id));
  assert.equal(ambiguousPayments[0].orderId, createdOrder.id);
  assert.equal(ambiguousPayments[0].paymentStatus, 'pending');
  assert.equal(ambiguousPayments[0].orderStatus, 'paid');
  assert.equal(ambiguousPayments[0].depositAddress, createdOrder.deposit_address);
  assert.equal(ambiguousPayments[0].hasSweepEvidence, true);
  assert.equal(ambiguousPayments[0].hasObservedDeposits, false);
  assert.equal(ambiguousPayments[0].sweptAmountUsdt, TICKET_PRICE_USDT);
  assert.equal(ambiguousPayments[0].latestSweepTxHash, '0xambiguoussweeptx');
});

test('fetchAmbiguousUnconfirmedPaymentRecords lists an unconfirmed payment with an observed deposit', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  await updateOrderStatus(createdOrder.id, 'paid');
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xobservedonly');

  const ambiguousPayments = await fetchAmbiguousUnconfirmedPaymentRecords();

  assert.equal(ambiguousPayments.length, 1);
  assert.equal(ambiguousPayments[0].hasObservedDeposits, true);
  assert.equal(ambiguousPayments[0].hasSweepEvidence, false);
  assert.equal(ambiguousPayments[0].observedAmountUsdt, TICKET_PRICE_USDT);
});

test('fetchAmbiguousUnconfirmedPaymentRecords ignores a payment with no money evidence at all', async () => {
  await createOrderForUnconfirmedBooking();

  const ambiguousPayments = await fetchAmbiguousUnconfirmedPaymentRecords();

  assert.deepEqual(ambiguousPayments, []);
});

test('fetchAmbiguousUnconfirmedPaymentRecords ignores a confirmed payment', async () => {
  const { bookingRecord, createdOrder } = await createOrderForUnconfirmedBooking();
  await updateOrderStatus(createdOrder.id, 'paid');
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xconfirmedpayment');

  const paymentRecord = await pool.query('SELECT id FROM payments WHERE booking_id = $1', [
    bookingRecord.id,
  ]);
  await pool.query(
    `UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
    [paymentRecord.rows[0].id]
  );

  const ambiguousPayments = await fetchAmbiguousUnconfirmedPaymentRecords();

  assert.deepEqual(ambiguousPayments, []);
});
test('verifyPaymentAgainstSweepEvidence ignores a swept row whose block is not finalized yet', async () => {
  const { createdOrder } = await createOrderForUnconfirmedBooking();
  const sweepId = await recordSweepRow(
    createdOrder.id,
    createdOrder.deposit_address,
    TICKET_PRICE_USDT,
    { status: 'swept', txHash: '0xunfinalizedsweeptx' }
  );
  await pool.query(
    'UPDATE sweeps SET block_number = 1200, is_finalized = false WHERE id = $1',
    [sweepId]
  );

  const unfinalizedVerification = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(unfinalizedVerification.paid, false);
  assert.equal(unfinalizedVerification.reason, PAYMENT_NOT_FOUND_IN_EVIDENCE);
  assert.deepEqual(unfinalizedVerification.sweepRecords, []);

  await pool.query('UPDATE sweeps SET is_finalized = true WHERE id = $1', [sweepId]);

  const finalizedVerification = await verifyPaymentAgainstSweepEvidence({
    orderId: createdOrder.id,
    depositAddress: createdOrder.deposit_address,
    expectedAmountWei: TICKET_PRICE_WEI,
  });

  assert.equal(finalizedVerification.paid, true);
  assert.equal(finalizedVerification.reason, PAYMENT_VERIFIED_FROM_SWEEP_EVIDENCE_ONLY);
});
