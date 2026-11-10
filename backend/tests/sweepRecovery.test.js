import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
  updatePaymentRecordStatus,
} from '../services/paymentService.js';
import {
  createOrderWithDepositAddressForBooking,
  fetchDepositAddressRecordsForOrderId,
  updateOrderStatus,
} from '../services/orderService.js';

import {
  evaluateDepositCollectionReadiness,
  fetchAbandonedOrdersEligibleForRecoverySweep,
  fetchSweepRecordByOrderId,
  runSweepCycle,
} from '../services/sweepService.js';

import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

const TEST_TREASURY_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_USDT_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const TEST_SWEEP_TRANSACTION_HASH = '0xrecoverysweeptxhash0001';
const TICKET_PRICE_USDT = 3.8;
const GAS_PRICE_WEI = ethers.parseUnits('5', 'gwei');

const previousTreasuryAddress = process.env.TREASURY_WALLET_ADDRESS;
const previousUsdtContractAddress = process.env.USDT_CONTRACT_ADDRESS;

process.env.TREASURY_WALLET_ADDRESS = TEST_TREASURY_ADDRESS;
process.env.USDT_CONTRACT_ADDRESS = TEST_USDT_CONTRACT_ADDRESS;

after(() => {
  if (previousTreasuryAddress === undefined) {
    delete process.env.TREASURY_WALLET_ADDRESS;
  } else {
    process.env.TREASURY_WALLET_ADDRESS = previousTreasuryAddress;
  }
  if (previousUsdtContractAddress === undefined) {
    delete process.env.USDT_CONTRACT_ADDRESS;
  } else {
    process.env.USDT_CONTRACT_ADDRESS = previousUsdtContractAddress;
  }
});

let recoveryBookingCounter = 0;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  recoveryBookingCounter = 0;
}

beforeEach(resetDatabaseState);

async function recordObservedDeposit({
  depositAddressRecord,
  orderId,
  amountUsdt,
  blockNumber,
  txHash,
}) {
  await pool.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id, confirmations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
    [
      depositAddressRecord.address,
      txHash,
      '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      amountUsdt,
      ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
      blockNumber,
      `0xblock${blockNumber}`,
      orderId,
    ]
  );
}

async function createOrderForRecoveryTest({
  expiredHoursAgo = 48,
  depositUsdt = 1.5,
  markAsPaid = false,
} = {}) {
  recoveryBookingCounter += 1;
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: `Recovery Sweep ${recoveryBookingCounter}`,
    email: `recovery-sweep-${recoveryBookingCounter}@example.com`,
    phone_number: `+255712349${String(100 + recoveryBookingCounter).padStart(3, '0')}`,
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

  const orderStatus = markAsPaid ? 'paid' : 'expired';
  await updateOrderStatus(createdOrder.id, orderStatus);
  await pool.query(
    `UPDATE orders
        SET expires_at = now() - make_interval(hours => $2)
      WHERE id = $1`,
    [createdOrder.id, expiredHoursAgo]
  );

  if (markAsPaid) {
    const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
    await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');
    await pool.query(
      `UPDATE payments SET confirmed_at = now() - make_interval(hours => $2) WHERE id = $1`,
      [paymentRecord.id, expiredHoursAgo]
    );
  }

  const depositAddressRecords = await fetchDepositAddressRecordsForOrderId(createdOrder.id);
  const activeDepositAddress = depositAddressRecords.find((record) => record.is_active);
  await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: depositUsdt,
    blockNumber: 900,
    txHash: `0xrecoverydeposit${recoveryBookingCounter}`,
  });

  return { bookingRecord, createdOrder, activeDepositAddress };
}

function buildStubSweepProvider() {
  return {
    getTransactionCount: async () => 9,
    broadcastTransaction: async () => ({
      hash: TEST_SWEEP_TRANSACTION_HASH,
      wait: async () => ({
        hash: TEST_SWEEP_TRANSACTION_HASH,
        gasUsed: 65000n,
        status: 1,
        blockNumber: 1500,
        blockHash: '0xrecoverysweepblock',
      }),
    }),
  };
}

test('an abandoned underpayment becomes collectable only after the minimum age', () => {
  const afterMinimumAge = evaluateDepositCollectionReadiness({
    balanceUsdt: 1.5,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: null,
    orderExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    now: new Date('2026-01-03T00:00:00.000Z'),
    minimumAgeHours: 24,
  });
  assert.equal(afterMinimumAge.collectable, true);
  assert.equal(afterMinimumAge.reason, 'ABANDONED_ORDER_RECOVERY');

  const beforeMinimumAge = evaluateDepositCollectionReadiness({
    balanceUsdt: 1.5,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: null,
    orderExpiresAt: new Date('2026-01-02T23:00:00.000Z'),
    now: new Date('2026-01-03T00:00:00.000Z'),
    minimumAgeHours: 24,
  });
  assert.equal(beforeMinimumAge.collectable, false);
  assert.equal(beforeMinimumAge.reason, 'BELOW_EXPECTED_AMOUNT');
});

test('an abandoned balance below the recovery floor is left in place', () => {
  const readiness = evaluateDepositCollectionReadiness({
    balanceUsdt: 0.1,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: null,
    orderExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    now: new Date('2026-01-03T00:00:00.000Z'),
    minimumAgeHours: 24,
  });
  assert.equal(readiness.collectable, false);
  assert.equal(readiness.reason, 'BELOW_RECOVERY_MINIMUM');
});

test('a confirmed payment past the minimum age is still collected before the recovery rule', () => {
  const readiness = evaluateDepositCollectionReadiness({
    balanceUsdt: 1.5,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
    orderExpiresAt: new Date('2025-12-01T00:00:00.000Z'),
    now: new Date('2026-01-03T00:00:00.000Z'),
    minimumAgeHours: 24,
  });
  assert.equal(readiness.collectable, true);
  assert.equal(readiness.reason, 'CONFIRMED_AND_SETTLED');
});

test('fetchAbandonedOrdersEligibleForRecoverySweep finds only abandoned funded orders', async () => {
  const { createdOrder: abandonedOrder } = await createOrderForRecoveryTest({
    expiredHoursAgo: 48,
    depositUsdt: 1.5,
  });
  const { createdOrder: freshExpiredOrder } = await createOrderForRecoveryTest({
    expiredHoursAgo: 1,
    depositUsdt: 1.5,
  });
  const { createdOrder: confirmedPaidOrder } = await createOrderForRecoveryTest({
    expiredHoursAgo: 48,
    depositUsdt: TICKET_PRICE_USDT,
    markAsPaid: true,
  });

  const eligibleOrders = await fetchAbandonedOrdersEligibleForRecoverySweep({
    minimumAgeHours: 24,
  });

  assert.deepEqual(
    eligibleOrders.map((orderRow) => orderRow.order_id),
    [abandonedOrder.id]
  );
  assert.equal(eligibleOrders[0].confirmed_at, null);
  assert.ok(eligibleOrders[0].order_expires_at);
  assert.notEqual(eligibleOrders[0].order_id, freshExpiredOrder.id);
  assert.notEqual(eligibleOrders[0].order_id, confirmedPaidOrder.id);
});

test('runSweepCycle collects an abandoned order and leaves the order expired', async () => {
  const { createdOrder } = await createOrderForRecoveryTest({
    expiredHoursAgo: 48,
    depositUsdt: 1.5,
  });

  const sweepResults = await runSweepCycle({
    provider: buildStubSweepProvider(),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => ethers.parseUnits('1.5', DEFAULT_USDT_DECIMALS),
    fetchBnbBalance: async () => ethers.parseEther('1'),
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserializedrecoverysweep',
    fetchTransactionReceipt: async (transactionHash) => ({
      hash: transactionHash,
      status: 1,
      gasUsed: 65000n,
      blockNumber: 1500,
      blockHash: '0xrecoverysweepblock',
    }),
    fetchSettlementFrontier: async () => ({
      latestBlockNumber: 2000,
      finalizedBlockNumber: 2000,
      settledBy: 'finalized',
    }),
    fetchDailySponsoredBnbWei: async () => 0n,
    alertOnSweepFailure: async () => {},
    minimumAgeHours: 24,
  });

  assert.equal(sweepResults.length, 1);
  assert.equal(sweepResults[0].swept, true);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'swept');
  assert.equal(Number(sweepRecord.amount), 1.5);

  const treasuryLedgerResult = await pool.query(
    'SELECT amount FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(treasuryLedgerResult.rows.length, 1);
  assert.equal(Number(treasuryLedgerResult.rows[0].amount), 1.5);

  const orderResult = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderResult.rows[0].status, 'expired');
});

test('runSweepCycle never sweeps the same order twice in one cycle', async () => {
  const { createdOrder } = await createOrderForRecoveryTest({
    expiredHoursAgo: 48,
    depositUsdt: 1.5,
  });
  const duplicateOrderRow = {
    order_id: createdOrder.id,
    customer_id: 1,
    amount_usdt: TICKET_PRICE_USDT,
    booking_id: 1,
    order_expires_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    deposit_address: (
      await fetchDepositAddressRecordsForOrderId(createdOrder.id)
    ).find((record) => record.is_active).address,
    derivation_index: 0,
    confirmed_at: null,
  };

  let usdtBalanceFetchCount = 0;
  const sweepResults = await runSweepCycle({
    provider: buildStubSweepProvider(),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => {
      usdtBalanceFetchCount += 1;
      return ethers.parseUnits('1.5', DEFAULT_USDT_DECIMALS);
    },
    fetchBnbBalance: async () => ethers.parseEther('1'),
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserializedrecoverysweep',
    fetchTransactionReceipt: async (transactionHash) => ({
      hash: transactionHash,
      status: 1,
      gasUsed: 65000n,
      blockNumber: 1500,
      blockHash: '0xrecoverysweepblock',
    }),
    fetchSettlementFrontier: async () => ({
      latestBlockNumber: 2000,
      finalizedBlockNumber: 2000,
      settledBy: 'finalized',
    }),
    fetchDailySponsoredBnbWei: async () => 0n,
    alertOnSweepFailure: async () => {},
    minimumAgeHours: 24,
    fetchEligibleOrders: async () => [duplicateOrderRow],
    fetchAbandonedEligibleOrders: async () => [duplicateOrderRow],
  });

  assert.equal(sweepResults.length, 1);
  assert.equal(usdtBalanceFetchCount, 1);
});
