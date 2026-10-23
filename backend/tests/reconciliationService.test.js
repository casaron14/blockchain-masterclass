import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  fetchSumOfConfirmedDepositsUsdt,
  fetchSumOfTreasuryLedgerUsdt,
  fetchSumOfConfirmedOrderDepositsUsdt,
  fetchSumOfInFlightConfirmedDepositsUsdt,
  runReconciliationCheck,
  runReconciliationRun,
  persistReconciliationRunSummary,
  fetchMostRecentReconciliationRun,
  generateAdminSummaryReport,
} from '../services/reconciliationService.js';

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

let reconciliationBookingCounter = 0;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('TRUNCATE reconciliation_runs');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  reconciliationBookingCounter = 0;
}

beforeEach(resetDatabaseState);

async function createOrderForBooking() {
  reconciliationBookingCounter += 1;
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: `Reconcile User ${reconciliationBookingCounter}`,
    email: `reconcile${reconciliationBookingCounter}@example.com`,
    phone_number: `+2557123456${String(50 + reconciliationBookingCounter).padStart(2, '0')}`,
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  return { bookingRecord, createdOrder };
}

async function createPaidOrderWithDepositAddress() {
  const { bookingRecord, createdOrder } = await createOrderForBooking();
  await updateOrderStatus(createdOrder.id, 'paid');
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

async function recordCollectedSweep(orderId, depositAddress, amountUsdt, txHash) {
  const sweepResult = await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, status, tx_hash, triggered_by)
     VALUES ($1, $2, $3, $4, 'swept', $5, 'scheduled')
     RETURNING id`,
    [
      orderId,
      depositAddress,
      amountUsdt,
      ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
      txHash,
    ]
  );
  await pool.query(
    `INSERT INTO treasury_ledger (order_id, sweep_id, tx_hash, amount)
     VALUES ($1, $2, $3, $4)`,
    [orderId, sweepResult.rows[0].id, txHash, amountUsdt]
  );
}

test('fetchSumOfConfirmedDepositsUsdt and fetchSumOfTreasuryLedgerUsdt aggregate recorded amounts', async () => {
  const { createdOrder } = await createPaidOrderWithDepositAddress();

  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xobs1');
  assert.equal(await fetchSumOfConfirmedDepositsUsdt(), TICKET_PRICE_USDT);

  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, 6, '0xobs2');
  assert.equal(await fetchSumOfConfirmedDepositsUsdt(), TICKET_PRICE_USDT + 6);

  assert.equal(await fetchSumOfTreasuryLedgerUsdt(), 0);
});

test('fetchSumOfConfirmedOrderDepositsUsdt excludes deposits on orders that never confirmed', async () => {
  const { createdOrder: abandonedOrder } = await createOrderForBooking();
  await updateOrderStatus(abandonedOrder.id, 'expired');
  await recordObservedDeposit(abandonedOrder.id, abandonedOrder.deposit_address, 12, '0xabandoneddeposit');

  const { createdOrder: confirmedOrder } = await createPaidOrderWithDepositAddress();
  await recordObservedDeposit(confirmedOrder.id, confirmedOrder.deposit_address, TICKET_PRICE_USDT, '0xrevenueusdt');

  assert.equal(await fetchSumOfConfirmedDepositsUsdt(), 12 + TICKET_PRICE_USDT);
  assert.equal(await fetchSumOfConfirmedOrderDepositsUsdt(), TICKET_PRICE_USDT);
});

test('fetchSumOfInFlightConfirmedDepositsUsdt counts observed deposits that are not collected yet', async () => {
  const { createdOrder: inFlightOrder } = await createPaidOrderWithDepositAddress();
  await recordObservedDeposit(inFlightOrder.id, inFlightOrder.deposit_address, TICKET_PRICE_USDT, '0xinflightdeposit');

  const { createdOrder: collectedOrder } = await createPaidOrderWithDepositAddress();
  await recordObservedDeposit(collectedOrder.id, collectedOrder.deposit_address, TICKET_PRICE_USDT, '0xcollecteddeposit');
  await recordCollectedSweep(
    collectedOrder.id,
    collectedOrder.deposit_address,
    TICKET_PRICE_USDT,
    '0xcollectedsweeptx'
  );

  assert.equal(await fetchSumOfInFlightConfirmedDepositsUsdt(), TICKET_PRICE_USDT);
  assert.equal(await fetchSumOfConfirmedOrderDepositsUsdt(), TICKET_PRICE_USDT * 2);
});

test('runReconciliationCheck reports an in-flight deposit as settled-later rather than as a mismatch', async () => {
  const { createdOrder } = await createPaidOrderWithDepositAddress();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xinflightdeposit');

  const reconciliationResult = await runReconciliationCheck({
    fetchOnChainBalance: async () => 0,
  });

  assert.equal(reconciliationResult.confirmedDepositsUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.inFlightDepositsUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.settledDepositsUsdt, 0);
  assert.equal(reconciliationResult.treasuryLedgerUsdt, 0);
  assert.equal(reconciliationResult.onChainTreasuryUsdt, 0);
  assert.equal(reconciliationResult.ledgerMismatch, false);
  assert.equal(reconciliationResult.chainMismatch, false);
  assert.equal(reconciliationResult.balanced, true);
});

test('runReconciliationCheck detects a ledger vs on-chain mismatch', async () => {
  const { createdOrder } = await createPaidOrderWithDepositAddress();

  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xledgerdeposit');
  await recordCollectedSweep(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xledgersweeptx');

  const reconciliationResult = await runReconciliationCheck({
    fetchOnChainBalance: async () => 10,
  });

  assert.equal(reconciliationResult.confirmedDepositsUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.inFlightDepositsUsdt, 0);
  assert.equal(reconciliationResult.treasuryLedgerUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.onChainTreasuryUsdt, 10);
  assert.equal(reconciliationResult.ledgerMismatch, false);
  assert.equal(reconciliationResult.chainMismatch, true);
  assert.equal(reconciliationResult.balanced, false);
});

test('runReconciliationCheck detects money missing from the treasury ledger', async () => {
  const { createdOrder } = await createPaidOrderWithDepositAddress();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xmissingledgertx');
  await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, status, tx_hash)
     VALUES ($1, $2, $3, $4, 'swept', '0xunledgeredsweeptx')`,
    [
      createdOrder.id,
      createdOrder.deposit_address,
      TICKET_PRICE_USDT,
      TICKET_PRICE_WEI.toString(),
    ]
  );

  const reconciliationResult = await runReconciliationCheck({
    fetchOnChainBalance: async () => TICKET_PRICE_USDT,
  });

  assert.equal(reconciliationResult.settledDepositsUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.treasuryLedgerUsdt, 0);
  assert.equal(reconciliationResult.ledgerMismatch, true);
  assert.equal(reconciliationResult.mismatchUsdt, -TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.balanced, false);
});

test('runReconciliationCheck reports balanced when ledger and on-chain agree', async () => {
  const reconciliationResult = await runReconciliationCheck({
    fetchConfirmedDeposits: async () => 0,
    fetchInFlightDeposits: async () => 0,
    fetchTreasuryLedgerTotal: async () => 0,
    fetchOnChainBalance: async () => 0,
  });
  assert.equal(reconciliationResult.balanced, true);
});

test('persistReconciliationRunSummary writes the run totals and details to the database', async () => {
  const persistedRun = await persistReconciliationRunSummary({
    startedAt: new Date('2026-01-05T08:00:00.000Z'),
    status: 'mismatch',
    observedTotal: TICKET_PRICE_USDT,
    ledgerTotal: 0,
    onchainTreasuryTotal: 0,
    mismatchUsdt: -TICKET_PRICE_USDT,
    details: {
      inFlightDepositsUsdt: 0,
      settledDepositsUsdt: TICKET_PRICE_USDT,
      ledgerMismatch: true,
      chainMismatch: false,
      balanced: false,
      failureMessage: null,
    },
  });

  assert.equal(Number(persistedRun.id) > 0, true);
  assert.equal(persistedRun.status, 'mismatch');
  assert.equal(Number(persistedRun.observed_total), TICKET_PRICE_USDT);
  assert.equal(Number(persistedRun.ledger_total), 0);
  assert.equal(Number(persistedRun.mismatch_usdt), -TICKET_PRICE_USDT);
  assert.equal(persistedRun.details.ledgerMismatch, true);
  assert.ok(persistedRun.finished_at);

  const mostRecentRun = await fetchMostRecentReconciliationRun();
  assert.equal(Number(mostRecentRun.id), Number(persistedRun.id));
});

test('runReconciliationRun persists a balanced run with its measured totals', async () => {
  const { createdOrder } = await createPaidOrderWithDepositAddress();
  await recordObservedDeposit(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xbalanceddeposit');
  await recordCollectedSweep(createdOrder.id, createdOrder.deposit_address, TICKET_PRICE_USDT, '0xbalancedsweeptx');

  const reconciliationResult = await runReconciliationRun({
    fetchOnChainBalance: async () => TICKET_PRICE_USDT,
    startedAt: new Date('2026-01-05T09:00:00.000Z'),
  });

  assert.equal(reconciliationResult.status, 'balanced');
  assert.equal(reconciliationResult.balanced, true);
  assert.equal(reconciliationResult.confirmedDepositsUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.treasuryLedgerUsdt, TICKET_PRICE_USDT);
  assert.equal(reconciliationResult.inFlightDepositsUsdt, 0);
  assert.equal(reconciliationResult.runId > 0, true);

  const persistedRun = await fetchMostRecentReconciliationRun();
  assert.equal(persistedRun.status, 'balanced');
  assert.equal(Number(persistedRun.observed_total), TICKET_PRICE_USDT);
  assert.equal(Number(persistedRun.ledger_total), TICKET_PRICE_USDT);
  assert.equal(Number(persistedRun.onchain_treasury_total), TICKET_PRICE_USDT);
  assert.equal(Number(persistedRun.mismatch_usdt), 0);
  assert.equal(persistedRun.details.inFlightDepositsUsdt, 0);
  assert.equal(persistedRun.started_at.toISOString(), '2026-01-05T09:00:00.000Z');
});

test('runReconciliationRun persists a failed run instead of recording a clean reconciliation', async () => {
  const reconciliationResult = await runReconciliationRun({
    fetchOnChainBalance: async () => {
      throw new Error('RPC unreachable');
    },
  });

  assert.equal(reconciliationResult.status, 'failed');
  assert.equal(reconciliationResult.failureMessage, 'RPC unreachable');
  assert.equal(reconciliationResult.balanced, undefined);

  const persistedRun = await fetchMostRecentReconciliationRun();
  assert.equal(persistedRun.status, 'failed');
  assert.equal(persistedRun.observed_total, null);
  assert.equal(persistedRun.ledger_total, null);
  assert.equal(persistedRun.onchain_treasury_total, null);
  assert.equal(persistedRun.details.failureMessage, 'RPC unreachable');
});

test('generateAdminSummaryReport lists pending, paid and awaiting-sweep orders', async () => {
  const { createdOrder } = await createPaidOrderWithDepositAddress();

  const summaryReport = await generateAdminSummaryReport({
    fetchGatewayGasBalance: async () => 0n,
    fetchTreasuryBalance: async () => 0n,
  });

  assert.equal(summaryReport.paidOrderCount, 1);
  assert.equal(summaryReport.ordersAwaitingSweep.length, 1);
  assert.equal(summaryReport.ordersAwaitingSweep[0].orderId, createdOrder.id);
});