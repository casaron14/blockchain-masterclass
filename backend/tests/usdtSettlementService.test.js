import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  getExpectedPaymentAmountWei,
  getExpectedPaymentAmountUsdt,
  buildCumulativeObservedDepositSummary,
  evaluateOrderPaymentSettlement,
  buildUnderpaymentExpiryDecision,
  fetchObservedDepositRecordsForOrderId,
  fetchCumulativeObservedDepositSummaryForOrder,
  markObservedDepositsAsFinalized,
  fetchUnfinalizedObservedDepositRecords,
  refreshObservedDepositConfirmations,
} from '../services/usdtSettlementService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';
import { TICKET_PRICE_USDT } from '../services/eventConfigService.js';

const PAYER_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

function buildObservedDeposit({ amountUsdt, blockNumber, txHash, isFinalized = false }) {
  return {
    id: 1,
    order_id: 1,
    amount_usdt: String(amountUsdt),
    amount: Number(amountUsdt),
    amount_wei: ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
    block_number: blockNumber,
    block_hash: `0xblock${blockNumber}`,
    tx_hash: txHash,
    from_address: PAYER_ADDRESS,
    is_finalized: isFinalized,
  };
}

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

test('the expected amount follows the payment row, so an admin price override is honoured', () => {
  const staticExpectedWei = getExpectedPaymentAmountWei({});
  assert.equal(staticExpectedWei, ethers.parseUnits(String(TICKET_PRICE_USDT), 18));

  const overriddenExpectedWei = getExpectedPaymentAmountWei({ amount_expected: '7.5' });
  assert.equal(overriddenExpectedWei, ethers.parseUnits('7.5', 18));
  assert.equal(getExpectedPaymentAmountUsdt({ amount_expected: '7.5' }), 7.5);
});

test('a payment shorter than the overridden price is not ready', () => {
  const observedDeposits = [buildObservedDeposit({ amountUsdt: 3.8, blockNumber: 100, txHash: '0xa' })];

  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord: { amount_expected: '7.5' },
    observedDeposits,
    settlementFrontier: { latestBlockNumber: 110, finalizedBlockNumber: 110, settledBy: 'finalized' },
  });

  assert.equal(settlementDecision.ready, false);
  assert.equal(settlementDecision.reason, 'AMOUNT_UNDERPAID');
});

test('two half payments add up to a complete payment', () => {
  const observedDeposits = [
    buildObservedDeposit({ amountUsdt: 1.9, blockNumber: 100, txHash: '0xfirst' }),
    buildObservedDeposit({ amountUsdt: 1.9, blockNumber: 105, txHash: '0xsecond' }),
  ];

  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord: { amount_expected: '3.80' },
    observedDeposits,
    settlementFrontier: { latestBlockNumber: 110, finalizedBlockNumber: 110, settledBy: 'finalized' },
  });

  assert.equal(settlementDecision.ready, true);
  assert.equal(settlementDecision.observedDepositCount, 2);
  assert.equal(settlementDecision.totalAmountUsdt, 3.8);
  assert.equal(settlementDecision.completingDeposit.tx_hash, '0xsecond');
});

test('a payment is not ready while the chain has not settled its block', () => {
  const observedDeposits = [buildObservedDeposit({ amountUsdt: 3.8, blockNumber: 108, txHash: '0xfresh' })];

  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord: { amount_expected: '3.80' },
    observedDeposits,
    settlementFrontier: { latestBlockNumber: 110, finalizedBlockNumber: 105, settledBy: 'finalized' },
  });

  assert.equal(settlementDecision.ready, false);
  assert.equal(settlementDecision.reason, 'NOT_FINALIZED_YET');
  assert.equal(settlementDecision.confirmations, 3);
});

test('no observed transfer at all is reported as such instead of as an underpayment', () => {
  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord: { amount_expected: '3.80' },
    observedDeposits: [],
    settlementFrontier: { latestBlockNumber: 110, finalizedBlockNumber: 110, settledBy: 'finalized' },
  });

  assert.equal(settlementDecision.ready, false);
  assert.equal(settlementDecision.reason, 'NO_DEPOSIT_OBSERVED');
});

test('a split payment of 1.9 + 1.899999999999999999 is still short by one wei unit', () => {
  const observedDeposits = [
    {
      ...buildObservedDeposit({ amountUsdt: 1.9, blockNumber: 100, txHash: '0xfirst' }),
      amount_wei: '1900000000000000000',
    },
    {
      ...buildObservedDeposit({ amountUsdt: 1.899999999999999999, blockNumber: 105, txHash: '0xsecond' }),
      amount_wei: '1899999999999999999',
    },
  ];

  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord: { amount_expected: '3.80' },
    observedDeposits,
    settlementFrontier: { latestBlockNumber: 110, finalizedBlockNumber: 110, settledBy: 'finalized' },
  });

  assert.equal(settlementDecision.ready, false);
  assert.equal(settlementDecision.reason, 'AMOUNT_UNDERPAID');
  assert.equal(settlementDecision.totalAmountUsdt, 3.8);
});

test('the cumulative summary reports the completing deposit and the exact total', () => {
  const cumulativeSummary = buildCumulativeObservedDepositSummary([
    buildObservedDeposit({ amountUsdt: 1.5, blockNumber: 100, txHash: '0xfirst' }),
    buildObservedDeposit({ amountUsdt: 2.3, blockNumber: 140, txHash: '0xsecond' }),
  ]);

  assert.equal(cumulativeSummary.observedDepositCount, 2);
  assert.equal(cumulativeSummary.latestObservedBlockNumber, 140);
  assert.equal(cumulativeSummary.completingDeposit.tx_hash, '0xsecond');
  assert.equal(cumulativeSummary.totalAmountUsdt, 3.8);
});

test('an underpayment inside the hold is not abandoned', () => {
  const underpaymentDecision = buildUnderpaymentExpiryDecision({
    observedAmountWei: 1_900_000_000_000_000_000n,
    expectedAmountWei: 3_800_000_000_000_000_000n,
    orderExpired: false,
    underpaymentGracePeriodMinutes: 0,
  });

  assert.equal(underpaymentDecision.abandoned, false);
  assert.equal(underpaymentDecision.reason, 'STILL_WITHIN_HOLD');
});

test('an underpayment after the hold lapsed is abandoned for review once the grace period is over', () => {
  const underpaymentDecision = buildUnderpaymentExpiryDecision({
    observedAmountWei: 1_900_000_000_000_000_000n,
    expectedAmountWei: 3_800_000_000_000_000_000n,
    orderExpired: true,
    underpaymentGracePeriodMinutes: 0,
  });

  assert.equal(underpaymentDecision.abandoned, true);
  assert.equal(underpaymentDecision.shortfallWei, 1_900_000_000_000_000_000n);
});

test('observed deposits can be read back, finalized, and re-counted for confirmations', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Settlement Test Attendee',
    email: `settlement-${Date.now()}@example.com`,
    phone_number: '+255712345111',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

  await pool.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id, confirmations)
     VALUES
       ($1, '0xsettlefirst', $2, 1.90, $3, 500, '0xblock500', $4, 1),
       ($1, '0xsettlesecond', $2, 1.90, $3, 505, '0xblock505', $4, 1)`,
    [
      createdOrder.deposit_address,
      PAYER_ADDRESS,
      ethers.parseUnits('1.9', DEFAULT_USDT_DECIMALS).toString(),
      createdOrder.id,
    ]
  );

  const observedDeposits = await fetchObservedDepositRecordsForOrderId(createdOrder.id);
  assert.equal(observedDeposits.length, 2);
  assert.equal(observedDeposits.every((deposit) => deposit.is_finalized === false), true);

  const unfinalizedBefore = await fetchUnfinalizedObservedDepositRecords();
  assert.ok(unfinalizedBefore.length >= 2);

  const finalizedCount = await markObservedDepositsAsFinalized(
    observedDeposits.map((deposit) => deposit.id),
    510
  );
  assert.equal(finalizedCount, 2);

  const cumulativeSummary = await fetchCumulativeObservedDepositSummaryForOrder(createdOrder.id);
  assert.equal(cumulativeSummary.totalAmountUsdt, 3.8);
  assert.equal(cumulativeSummary.latestObservedBlockNumber, 505);

  await refreshObservedDepositConfirmations(600);
  const confirmationsResult = await pool.query(
    'SELECT confirmations FROM deposits_observed WHERE order_id = $1 ORDER BY block_number',
    [createdOrder.id]
  );
  assert.deepEqual(
    confirmationsResult.rows.map((row) => Number(row.confirmations)),
    [101, 96]
  );
});
