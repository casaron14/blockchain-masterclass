import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  runSweepJob,
  getSweepIntervalHours,
  computeHoursSinceLastSweep,
  SWEEP_SKIPPED_ALREADY_SWEPT_TODAY,
} from '../jobs/sweepJob.js';

import {
  createOrderWithDepositAddressForBooking,
  updateOrderStatus,
} from '../services/orderService.js';

import {
  fetchSweepRecordByOrderId,
} from '../services/sweepService.js';

import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
  updatePaymentRecordStatus,
} from '../services/paymentService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

const TICKET_PRICE_USDT = 3.8;
const TICKET_PRICE_WEI = ethers.parseUnits(String(TICKET_PRICE_USDT), DEFAULT_USDT_DECIMALS);
const GAS_PRICE_WEI = ethers.parseUnits('5', 'gwei');
const HOURS_AGO_48 = '48 hours';

let sweepJobBookingCounter = 0;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  sweepJobBookingCounter = 0;
}

beforeEach(resetDatabaseState);

async function createSettledPaidOrder(confirmedAgoInterval = HOURS_AGO_48) {
  sweepJobBookingCounter += 1;
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: `Sweep Job ${sweepJobBookingCounter}`,
    email: `sweepjob${sweepJobBookingCounter}@example.com`,
    phone_number: `+2557123456${String(30 + sweepJobBookingCounter).padStart(2, '0')}`,
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  await updateOrderStatus(createdOrder.id, 'paid');

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');
  await pool.query(
    `UPDATE payments SET confirmed_at = now() - $2::interval WHERE id = $1`,
    [paymentRecord.id, confirmedAgoInterval]
  );
  return createdOrder;
}

function buildStubProvider() {
  return {
    getTransactionCount: async () => 5,
    getBalance: async () => ethers.parseEther('1'),
    broadcastTransaction: async () => ({
      wait: async () => ({
        hash: '0xconfirmedsweeptxhash001',
        gasUsed: 65000n,
        status: 1,
        blockNumber: 1234,
        blockHash: '0xsweepblockhash001',
      }),
    }),
  };
}

function buildStubSweepCycleDeps() {
  return {
    provider: buildStubProvider(),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => ethers.parseEther('1'),
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserializedsweeptx',
    minimumAgeHours: 24,
  };
}

test('getSweepIntervalHours defaults to 24 hours and honours the environment override', () => {
  const previousIntervalHours = process.env.SWEEP_INTERVAL_HOURS;
  delete process.env.SWEEP_INTERVAL_HOURS;
  try {
    assert.equal(getSweepIntervalHours(), 24);

    process.env.SWEEP_INTERVAL_HOURS = '12';
    assert.equal(getSweepIntervalHours(), 12);
  } finally {
    if (previousIntervalHours === undefined) {
      delete process.env.SWEEP_INTERVAL_HOURS;
    } else {
      process.env.SWEEP_INTERVAL_HOURS = previousIntervalHours;
    }
  }
});

test('computeHoursSinceLastSweep reports null when no sweep has ever run', () => {
  assert.equal(computeHoursSinceLastSweep(null), null);
});

test('runSweepJob collects settled deposits on the first run of the window', async () => {
  const createdOrder = await createSettledPaidOrder();

  const sweepJobSummary = await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
  });

  assert.equal(sweepJobSummary.skipped, false);
  assert.equal(sweepJobSummary.sweptCount, 1);
  assert.equal(sweepJobSummary.failedCount, 0);
  assert.equal(sweepJobSummary.results[0].swept, true);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'swept');
  assert.equal(sweepRecord.triggered_by, 'scheduled');
});

test('runSweepJob skips a second run inside the same daily window', async () => {
  await createSettledPaidOrder();

  const firstSweepJobSummary = await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
  });
  assert.equal(firstSweepJobSummary.skipped, false);

  const secondSweepJobSummary = await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
  });

  assert.equal(secondSweepJobSummary.skipped, true);
  assert.equal(secondSweepJobSummary.reason, SWEEP_SKIPPED_ALREADY_SWEPT_TODAY);
  assert.equal(secondSweepJobSummary.sweptCount, 0);
  assert.deepEqual(secondSweepJobSummary.results, []);
});

test('runSweepJob skips the collection entirely when a sweep already ran inside the window', async () => {
  await createSettledPaidOrder();

  await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
  });

  let sweepCycleRanAgain = false;
  const skippedSweepJobSummary = await runSweepJob({
    provider: buildStubProvider(),
    intervalHours: 24,
    runCycle: async () => {
      sweepCycleRanAgain = true;
      return [];
    },
  });

  assert.equal(sweepCycleRanAgain, false);
  assert.equal(skippedSweepJobSummary.skipped, true);
  assert.equal(skippedSweepJobSummary.reason, SWEEP_SKIPPED_ALREADY_SWEPT_TODAY);
});

test('runSweepJob still collects once the daily window has elapsed', async () => {
  const createdOrder = await createSettledPaidOrder();

  const previousDaySweepRun = await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, status, created_at)
     VALUES ($1, $2, 0, 0, 'failed', now() - interval '30 hours')`,
    [createdOrder.id, createdOrder.deposit_address]
  );
  assert.equal(previousDaySweepRun.rowCount, 1);

  const sweepJobSummary = await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
  });

  assert.equal(sweepJobSummary.skipped, false);
  assert.equal(sweepJobSummary.sweptCount, 1);
});

test('runSweepJob leaves a payment that is not settled past the minimum age untouched', async () => {
  const createdOrder = await createSettledPaidOrder('1 hour');

  const sweepJobSummary = await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
  });

  assert.equal(sweepJobSummary.skipped, false);
  assert.equal(sweepJobSummary.sweptCount, 0);
  assert.deepEqual(sweepJobSummary.results, []);

  const sweepRecords = await pool.query('SELECT id FROM sweeps WHERE order_id = $1', [createdOrder.id]);
  assert.equal(sweepRecords.rows.length, 0);
});

test('runSweepJob counts a failed collection without aborting the pass', async () => {
  const createdOrder = await createSettledPaidOrder();

  const alertedMessages = [];
  const sweepJobSummary = await runSweepJob({
    sweepCycleDependencies: {
      ...buildStubSweepCycleDeps(),
      alertOnSweepFailure: async (alertMessage) => {
        alertedMessages.push(alertMessage);
      },
      signSweepTransaction: async () => {
        throw new Error('insufficient gas wallet funds');
      },
    },
    intervalHours: 24,
  });

  assert.equal(sweepJobSummary.skipped, false);
  assert.equal(sweepJobSummary.sweptCount, 0);
  assert.equal(sweepJobSummary.failedCount, 1);
  assert.equal(sweepJobSummary.results[0].reason, 'SWEEP_ERROR');
  assert.equal(alertedMessages.length, 1);
  assert.match(alertedMessages[0], /insufficient gas wallet funds/);

  const failedSweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(failedSweepRecord.status, 'failed');
  assert.match(failedSweepRecord.failure_reason, /insufficient gas wallet funds/);
});

test('runSweepJob uses the newest sweeps row as the last-run timestamp after a restart', async () => {
  await createSettledPaidOrder();

  await runSweepJob({ sweepCycleDependencies: buildStubSweepCycleDeps(), intervalHours: 24 });

  const restartedProcessSummary = await runSweepJob({
    sweepCycleDependencies: buildStubSweepCycleDeps(),
    intervalHours: 24,
    runCycle: async () => {
      throw new Error('the collection pass must not run twice in one window');
    },
  });

  assert.equal(restartedProcessSummary.skipped, true);
  assert.ok(restartedProcessSummary.lastSweepRunAt instanceof Date);
  assert.equal(restartedProcessSummary.hoursSinceLastSweep < 1, true);
});