import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  isDepositBalanceAboveSweepThreshold,
  isDepositReadyForCollection,
  evaluateDepositCollectionReadiness,
  fetchPaidOrdersEligibleForSweep,
  fetchMostRecentSweepRecordTimestamp,
  getSweepMinimumAgeHours,
} from '../services/sweepService.js';

import {
  computeSweepGasFeeWei,
  fetchCurrentBscGasPrice,
  getSweepFallbackGasPriceWei,
} from '../services/gasWalletService.js';

import {
  runSweepCycle,
  sweepSingleOrder,
  fetchSweepRecordByOrderId,
  broadcastSweepTransactionWithGasBumpRetry,
  completeSweepRecordWithTreasuryMovement,
  createPendingSweepRecord,
  finalizeSettledSweepRecords,
  markSweepAsFunded,
  markSweepTransactionAsBroadcast,
} from '../services/sweepService.js';

import {
  GAS_SPONSORSHIP_PER_CYCLE_LIMIT_EXCEEDED,
  GAS_SPONSORSHIP_PER_SWEEP_LIMIT_EXCEEDED,
  GasSponsorshipLimitExceededError,
} from '../services/gasSponsorshipPolicyService.js';

import {
  createOrderWithDepositAddressForBooking,
  updateOrderStatus,
  fetchPaidOrdersAwaitingSweep,
} from '../services/orderService.js';

import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
  updatePaymentRecordStatus,
} from '../services/paymentService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

const TICKET_PRICE_USDT = 3.8;
const TICKET_PRICE_WEI = ethers.parseUnits(String(TICKET_PRICE_USDT), DEFAULT_USDT_DECIMALS);
const OVERSIZED_USDT_WEI = ethers.parseUnits('12', DEFAULT_USDT_DECIMALS);
const GAS_PRICE_WEI = ethers.parseUnits('5', 'gwei');
const TRANSFER_GAS = 65000n;
const HOURS_AGO_48 = '48 hours';
const SETTLEMENT_FRONTIER_STUB = {
  latestBlockNumber: 5000,
  finalizedBlockNumber: 4900,
  settledBy: 'depth',
};

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createPaidOrderWithDepositAddress() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Sweep User',
    email: 'sweep@example.com',
    phone_number: '+255712345675',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  await updateOrderStatus(createdOrder.id, 'paid');
  return { bookingRecord, createdOrder };
}

async function markBookingPaymentAsConfirmedAgo(bookingId, confirmedAgoInterval) {
  const paymentRecord = await fetchPaymentRecordByBookingId(bookingId);
  await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');
  await pool.query(
    `UPDATE payments
        SET confirmed_at = now() - $2::interval
      WHERE id = $1`,
    [paymentRecord.id, confirmedAgoInterval]
  );
}

async function createSettledPaidOrder(confirmedAgoInterval = HOURS_AGO_48) {
  const { bookingRecord, createdOrder } = await createPaidOrderWithDepositAddress();
  await markBookingPaymentAsConfirmedAgo(bookingRecord.id, confirmedAgoInterval);
  return { bookingRecord, createdOrder };
}

function buildStubProvider({ usdtBalanceWei = TICKET_PRICE_WEI, bnbBalanceWei = 0n } = {}) {
  return {
    getTransactionCount: async () => 5,
    getBalance: async () => bnbBalanceWei,
    broadcastTransaction: async (_serializedTransaction) => ({
      wait: async () => ({
        hash: '0xconfirmedsweeptxhash001',
        gasUsed: TRANSFER_GAS,
        status: 1,
        blockNumber: 1234,
        blockHash: '0xsweepblockhash001',
      }),
    }),
    usdtBalanceWei,
    bnbBalanceWei,
  };
}

test('isDepositBalanceAboveSweepThreshold accepts balances above the configured minimum', () => {
  assert.equal(isDepositBalanceAboveSweepThreshold(OVERSIZED_USDT_WEI), true);
  assert.equal(isDepositBalanceAboveSweepThreshold(0n), false);
});

test('isDepositReadyForCollection collects a confirmed deposit below the sweep threshold once it has settled', () => {
  const confirmedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date('2026-01-03T00:00:00.000Z');

  assert.equal(
    isDepositReadyForCollection({
      balanceUsdt: TICKET_PRICE_USDT,
      expectedAmountUsdt: TICKET_PRICE_USDT,
      confirmedAt,
      now,
    }),
    true
  );
});

test('isDepositReadyForCollection refuses a freshly confirmed deposit that sits below the sweep threshold', () => {
  const confirmedAt = new Date('2026-01-03T00:00:00.000Z');

  assert.equal(
    isDepositReadyForCollection({
      balanceUsdt: TICKET_PRICE_USDT,
      expectedAmountUsdt: TICKET_PRICE_USDT,
      confirmedAt,
      now: new Date('2026-01-03T01:00:00.000Z'),
    }),
    false
  );
});

test('isDepositReadyForCollection refuses an empty deposit address regardless of confirmation age', () => {
  assert.equal(
    isDepositReadyForCollection({
      balanceUsdt: 0,
      expectedAmountUsdt: TICKET_PRICE_USDT,
      confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      now: new Date('2026-01-03T00:00:00.000Z'),
    }),
    false
  );
});

test('isDepositReadyForCollection collects an unconfirmed deposit that is above the sweep threshold', () => {
  const readiness = evaluateDepositCollectionReadiness({
    balanceUsdt: 12,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: null,
    now: new Date('2026-01-03T00:00:00.000Z'),
  });

  assert.equal(readiness.collectable, true);
  assert.equal(readiness.reason, 'ABOVE_SWEEP_THRESHOLD');
});

test('isDepositReadyForCollection leaves an underpaid deposit alone while the payer may still be sending', () => {
  const readiness = evaluateDepositCollectionReadiness({
    balanceUsdt: 1.5,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: new Date('2026-01-03T00:00:00.000Z'),
    now: new Date('2026-01-03T02:00:00.000Z'),
  });

  assert.equal(readiness.collectable, false);
  assert.equal(readiness.reason, 'BELOW_EXPECTED_AMOUNT');
});

test('isDepositReadyForCollection collects an underpaid deposit once it can no longer grow', () => {
  const readiness = evaluateDepositCollectionReadiness({
    balanceUsdt: 1.5,
    expectedAmountUsdt: TICKET_PRICE_USDT,
    confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
    now: new Date('2026-01-03T00:00:00.000Z'),
  });

  assert.equal(readiness.collectable, true);
  assert.equal(readiness.reason, 'CONFIRMED_AND_SETTLED');
});

test('fetchPaidOrdersEligibleForSweep skips payments confirmed less than the minimum age ago', async () => {
  const { bookingRecord: recentlyConfirmedBooking, createdOrder: recentlyConfirmedOrder } =
    await createPaidOrderWithDepositAddress();
  await markBookingPaymentAsConfirmedAgo(recentlyConfirmedBooking.id, '1 hour');

  const { createdOrder: settledOrder } = await createSettledPaidOrder(HOURS_AGO_48);

  const eligibleOrders = await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 });

  assert.deepEqual(eligibleOrders.map((orderRow) => orderRow.order_id), [settledOrder.id]);

  const sweepRowsForRecentlyConfirmedOrder = await pool.query(
    'SELECT id FROM sweeps WHERE order_id = $1',
    [recentlyConfirmedOrder.id]
  );
  assert.equal(sweepRowsForRecentlyConfirmedOrder.rows.length, 0);
});

test('fetchPaidOrdersEligibleForSweep orders eligible payments oldest first', async () => {
  const { createdOrder: newestSettledOrder } = await createSettledPaidOrder('30 hours');
  const { createdOrder: oldestSettledOrder } = await createSettledPaidOrder('72 hours');

  const eligibleOrders = await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 });

  assert.deepEqual(
    eligibleOrders.map((orderRow) => orderRow.order_id),
    [oldestSettledOrder.id, newestSettledOrder.id]
  );
});

test('computeSweepGasFeeWei includes the configured buffer on top of gas units', () => {
  const gasFeeWei = computeSweepGasFeeWei(GAS_PRICE_WEI, 65000, 20);
  assert.equal(gasFeeWei, (GAS_PRICE_WEI * 65000n * 120n) / 100n);
});

test('fetchCurrentBscGasPrice falls back to maxFeePerGas when gasPrice is null', async () => {
  const gasPriceWei = await fetchCurrentBscGasPrice({
    getFeeData: async () => ({ gasPrice: null, maxFeePerGas: 7000000000n }),
  });
  assert.equal(gasPriceWei, 7000000000n);
});

test('fetchCurrentBscGasPrice falls back to the configured price when the node returns no gas price at all', async () => {
  const previousFallbackGasPrice = process.env.SWEEP_FALLBACK_GAS_PRICE_WEI;
  process.env.SWEEP_FALLBACK_GAS_PRICE_WEI = '4000000000';

  try {
    const gasPriceWei = await fetchCurrentBscGasPrice({
      getFeeData: async () => ({ gasPrice: null, maxFeePerGas: null }),
    });
    assert.equal(gasPriceWei, 4000000000n);
    assert.equal(getSweepFallbackGasPriceWei(), 4000000000n);
  } finally {
    if (previousFallbackGasPrice === undefined) {
      delete process.env.SWEEP_FALLBACK_GAS_PRICE_WEI;
    } else {
      process.env.SWEEP_FALLBACK_GAS_PRICE_WEI = previousFallbackGasPrice;
    }
  }
});

test('sweepSingleOrder leaves an empty deposit address unswept', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersAwaitingSweep())[0];

  const stubProvider = buildStubProvider({ usdtBalanceWei: 0n });
  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: stubProvider,
    gasWalletSigner: {},
    fetchUsdtBalance: async () => 0n,
    fetchBnbBalance: async () => 0n,
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
  });

  assert.equal(sweepResult.swept, false);
  assert.equal(sweepResult.reason, 'EMPTY_DEPOSIT_ADDRESS');

  const orderRecord = await pool.query('SELECT * FROM orders WHERE id = $1', [createdOrder.id]);
  assert.equal(orderRecord.rows[0].status, 'paid');
});

test('sweepSingleOrder refuses a freshly confirmed deposit that sits below the sweep threshold', async () => {
  const { bookingRecord, createdOrder } = await createPaidOrderWithDepositAddress();
  await markBookingPaymentAsConfirmedAgo(bookingRecord.id, '1 hour');

  const eligibleOrders = await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 });
  const paidOrderRow = {
    ...(await fetchPaidOrdersAwaitingSweep())[0],
    confirmed_at: new Date(),
  };
  assert.deepEqual(eligibleOrders, []);

  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: buildStubProvider(),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => 0n,
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
  });

  assert.equal(sweepResult.swept, false);
  assert.equal(sweepResult.reason, 'BELOW_SWEEP_THRESHOLD');

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [createdOrder.id]);
  assert.equal(orderRecord.rows[0].status, 'paid');
});

test('sweepSingleOrder funds the deposit address then sweeps and records the treasury movement', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];
  const fundingCalls = [];

  const stubProvider = buildStubProvider({ bnbBalanceWei: 0n });

  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: stubProvider,
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => 0n,
    fundDepositAddress: async (depositAddress, bnbAmountWei) => {
      fundingCalls.push({ depositAddress, bnbAmountWei });
    },
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async (derivationIndex, unsignedTransfer) => {
      assert.equal(derivationIndex, paidOrderRow.derivation_index);
      assert.equal(unsignedTransfer.gasLimit, 65000);
      return '0xserializedsweeptx';
    },
  });

  assert.equal(sweepResult.swept, true);
  assert.equal(sweepResult.txHash, '0xconfirmedsweeptxhash001');
  assert.equal(fundingCalls.length, 1);
  assert.equal(fundingCalls[0].depositAddress, paidOrderRow.deposit_address);

  const expectedBumpedMaxGasPriceWei = (GAS_PRICE_WEI * 140n) / 100n;
  const expectedFundingWei =
    (expectedBumpedMaxGasPriceWei * BigInt(65000) * 120n) / 100n;
  assert.equal(fundingCalls[0].bnbAmountWei, expectedFundingWei);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'swept');
  assert.equal(sweepRecord.tx_hash, '0xconfirmedsweeptxhash001');
  assert.equal(BigInt(sweepRecord.amount_wei), TICKET_PRICE_WEI);
  assert.equal(Number(sweepRecord.block_number), 1234);
  assert.equal(sweepRecord.gas_price_wei, GAS_PRICE_WEI.toString());
  assert.ok(sweepRecord.confirmed_at);

  const treasuryMovementRows = await pool.query(
    'SELECT * FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(treasuryMovementRows.rows.length, 1);
  assert.equal(Number(treasuryMovementRows.rows[0].amount), TICKET_PRICE_USDT);

  const orderRecord = await pool.query('SELECT * FROM orders WHERE id = $1', [createdOrder.id]);
  assert.equal(orderRecord.rows[0].status, 'swept');
});

test('runSweepCycle ignores payments that are not settled past the minimum age', async () => {
  const { bookingRecord, createdOrder } = await createPaidOrderWithDepositAddress();
  await markBookingPaymentAsConfirmedAgo(bookingRecord.id, '1 hour');

  const sweepResults = await runSweepCycle({
    provider: buildStubProvider(),
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => 0n,
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
    fetchSettlementFrontier: async () => SETTLEMENT_FRONTIER_STUB,
    minimumAgeHours: 24,
  });

  assert.deepEqual(sweepResults, []);

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [createdOrder.id]);
  assert.equal(orderRecord.rows[0].status, 'paid');
});

test('runSweepCycle collects a settled order and records who triggered the sweep', async () => {
  const { createdOrder } = await createSettledPaidOrder();

  const sweepResults = await runSweepCycle({
    provider: buildStubProvider({ bnbBalanceWei: ethers.parseEther('1') }),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => ethers.parseEther('1'),
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
    fetchSettlementFrontier: async () => SETTLEMENT_FRONTIER_STUB,
    minimumAgeHours: 24,
    triggeredBy: 'manual',
  });

  assert.equal(sweepResults.length, 1);
  assert.equal(sweepResults[0].swept, true);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.triggered_by, 'manual');
  assert.equal(sweepRecord.status, 'swept');
  assert.equal(sweepRecord.is_finalized, true);
});

test('runSweepCycle leaves an empty deposit address intact and reports why', async () => {
  const { createdOrder } = await createSettledPaidOrder();

  const sweepResults = await runSweepCycle({
    provider: buildStubProvider({ usdtBalanceWei: 0n }),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => 0n,
    fetchBnbBalance: async () => 0n,
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
    fetchSettlementFrontier: async () => SETTLEMENT_FRONTIER_STUB,
    minimumAgeHours: 24,
  });

  assert.equal(sweepResults.length, 1);
  assert.equal(sweepResults[0].swept, false);
  assert.equal(sweepResults[0].orderId, createdOrder.id);
  assert.equal(sweepResults[0].reason, 'EMPTY_DEPOSIT_ADDRESS');
});

test('fetchMostRecentSweepRecordTimestamp returns null before any sweep has run', async () => {
  assert.equal(await fetchMostRecentSweepRecordTimestamp(), null);
});

test('fetchMostRecentSweepRecordTimestamp returns the newest sweep row creation time', async () => {
  const { createdOrder } = await createSettledPaidOrder();

  await runSweepCycle({
    provider: buildStubProvider({ bnbBalanceWei: ethers.parseEther('1') }),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => ethers.parseEther('1'),
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
    fetchSettlementFrontier: async () => SETTLEMENT_FRONTIER_STUB,
    minimumAgeHours: 24,
  });

  const mostRecentSweepCreatedAt = await fetchMostRecentSweepRecordTimestamp();
  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(mostRecentSweepCreatedAt.getTime(), new Date(sweepRecord.created_at).getTime());
});

test('getSweepMinimumAgeHours defaults to 24 hours and honours the environment override', () => {
  const previousMinimumAgeHours = process.env.SWEEP_MINIMUM_AGE_HOURS;
  delete process.env.SWEEP_MINIMUM_AGE_HOURS;
  try {
    assert.equal(getSweepMinimumAgeHours(), 24);

    process.env.SWEEP_MINIMUM_AGE_HOURS = '6';
    assert.equal(getSweepMinimumAgeHours(), 6);
  } finally {
    if (previousMinimumAgeHours === undefined) {
      delete process.env.SWEEP_MINIMUM_AGE_HOURS;
    } else {
      process.env.SWEEP_MINIMUM_AGE_HOURS = previousMinimumAgeHours;
    }
  }
});

test('broadcastSweepTransactionWithGasBumpRetry bumps the gas price when the first broadcast fails', async () => {
  const provider = {
    broadcastTransaction: async () => {
      throw new Error('replacement transaction underpriced');
    },
  };

  const signedGasPrices = [];
  await assert.rejects(
    broadcastSweepTransactionWithGasBumpRetry({
      provider,
      depositAddress: '0xDepositAddress0000000000000000000000000000001',
      derivationIndex: 7,
      usdtBalanceWei: TICKET_PRICE_WEI,
      gasLimit: 65000,
      baseGasPriceWei: GAS_PRICE_WEI,
      maxRetries: 2,
      gasPriceBumpPercent: 20,
      signSweepTransaction: async (_derivationIndex, unsignedTransfer) => {
        signedGasPrices.push(unsignedTransfer.gasPrice);
        return '0xserialized';
      },
      fetchTransactionCount: async () => 3,
    }),
    /Sweep broadcast failed after 3 attempt\(s\)/
  );

  assert.equal(signedGasPrices.length, 3);
  assert.equal(signedGasPrices[0], GAS_PRICE_WEI);
  assert.equal(signedGasPrices[1], (GAS_PRICE_WEI * 120n) / 100n);
  assert.equal(signedGasPrices[2], (GAS_PRICE_WEI * 140n) / 100n);
});

test('sweepSingleOrder sweeps successfully when the first broadcast fails and the retry succeeds', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];

  let broadcastAttempts = 0;
  const retryStubProvider = {
    getTransactionCount: async () => 5,
    getBalance: async () => 0n,
    broadcastTransaction: async () => {
      broadcastAttempts += 1;
      if (broadcastAttempts === 1) {
        throw new Error('replacement transaction underpriced');
      }
      return {
        wait: async () => ({
          hash: '0xconfirmedsweeptxhash001',
          gasUsed: TRANSFER_GAS,
          status: 1,
        }),
      };
    },
  };

  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: retryStubProvider,
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => 0n,
    fundDepositAddress: async () => {},
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async (_derivationIndex, unsignedTransfer) => {
      if (broadcastAttempts === 1) {
        assert.equal(unsignedTransfer.gasPrice, (GAS_PRICE_WEI * 120n) / 100n);
      }
      return '0xserializedsweeptx';
    },
  });

  assert.equal(broadcastAttempts, 2);
  assert.equal(sweepResult.swept, true);
  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'swept');
});
test('broadcastSweepTransactionWithGasBumpRetry reads the nonce once and reuses it for every attempt', async () => {
  let transactionCountReadCount = 0;
  let broadcastAttemptCount = 0;
  const noncesUsedForSigning = [];

  const provider = {
    broadcastTransaction: async () => {
      broadcastAttemptCount += 1;
      if (broadcastAttemptCount < 3) {
        throw new Error('replacement transaction underpriced');
      }
      return {
        hash: '0xthirdattemptminedhash',
        wait: async () => ({
          hash: '0xthirdattemptminedhash',
          gasUsed: TRANSFER_GAS,
          status: 1,
        }),
      };
    },
  };

  const minedReceipt = await broadcastSweepTransactionWithGasBumpRetry({
    provider,
    depositAddress: '0xDepositAddress0000000000000000000000000000001',
    derivationIndex: 7,
    usdtBalanceWei: TICKET_PRICE_WEI,
    gasLimit: 65000,
    baseGasPriceWei: GAS_PRICE_WEI,
    maxRetries: 3,
    gasPriceBumpPercent: 20,
    signSweepTransaction: async (_derivationIndex, unsignedTransfer) => {
      noncesUsedForSigning.push(unsignedTransfer.nonce);
      return '0xserialized';
    },
    fetchTransactionCount: async () => {
      transactionCountReadCount += 1;
      return 7;
    },
    fetchTransactionReceipt: async () => null,
  });

  assert.equal(transactionCountReadCount, 1);
  assert.deepEqual(noncesUsedForSigning, [7, 7, 7]);
  assert.equal(minedReceipt.hash, '0xthirdattemptminedhash');
});

test('a wait timeout is resolved from the receipt instead of broadcasting a second transfer', async () => {
  let broadcastAttemptCount = 0;
  const broadcastHashes = [];
  const checkedReceiptHashes = [];

  const provider = {
    broadcastTransaction: async () => {
      broadcastAttemptCount += 1;
      return {
        hash: '0xminedbutwaitfailed',
        wait: async () => {
          throw new Error('timeout exceeded while waiting for transaction');
        },
      };
    },
  };

  const minedReceipt = await broadcastSweepTransactionWithGasBumpRetry({
    provider,
    depositAddress: '0xDepositAddress0000000000000000000000000000001',
    derivationIndex: 7,
    usdtBalanceWei: TICKET_PRICE_WEI,
    gasLimit: 65000,
    baseGasPriceWei: GAS_PRICE_WEI,
    maxRetries: 3,
    gasPriceBumpPercent: 20,
    signSweepTransaction: async () => '0xserialized',
    fetchTransactionCount: async () => 7,
    fetchTransactionReceipt: async (transactionHash) => {
      checkedReceiptHashes.push(transactionHash);
      return {
        hash: transactionHash,
        gasUsed: TRANSFER_GAS,
        status: 1,
        blockNumber: 4242,
        blockHash: '0xsweepblockhash4242',
      };
    },
    onTransactionBroadcast: async (transactionHash) => {
      broadcastHashes.push(transactionHash);
    },
  });

  assert.equal(broadcastAttemptCount, 1);
  assert.deepEqual(checkedReceiptHashes, ['0xminedbutwaitfailed']);
  assert.deepEqual(broadcastHashes, ['0xminedbutwaitfailed']);
  assert.equal(minedReceipt.status, 1);
  assert.equal(Number(minedReceipt.blockNumber), 4242);
});

test('a sweep transaction that reverted on chain is not retried', async () => {
  let broadcastAttemptCount = 0;

  const provider = {
    broadcastTransaction: async () => {
      broadcastAttemptCount += 1;
      return {
        hash: '0xrevertedswepthash',
        wait: async () => ({ hash: '0xrevertedswepthash', status: 0 }),
      };
    },
  };

  await assert.rejects(
    broadcastSweepTransactionWithGasBumpRetry({
      provider,
      depositAddress: '0xDepositAddress0000000000000000000000000000001',
      derivationIndex: 7,
      usdtBalanceWei: TICKET_PRICE_WEI,
      gasLimit: 65000,
      baseGasPriceWei: GAS_PRICE_WEI,
      maxRetries: 3,
      gasPriceBumpPercent: 20,
      signSweepTransaction: async () => '0xserialized',
      fetchTransactionCount: async () => 7,
      fetchTransactionReceipt: async () => null,
    }),
    /reverted on chain/
  );

  assert.equal(broadcastAttemptCount, 1);
});

test('completing the same sweep twice records exactly one treasury movement', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const sweepRecord = await createPendingSweepRecord(
    createdOrder.id,
    '0xDepositAddress0000000000000000000000000000002',
    TICKET_PRICE_WEI,
    { treasuryAddress: '0xTreasuryAddress00000000000000000000000000001' }
  );

  const completionInput = {
    sweepId: sweepRecord.id,
    orderId: createdOrder.id,
    txHash: '0xidempotentsweephash',
    gasUsed: Number(TRANSFER_GAS),
    blockNumber: 8888,
    blockHash: '0xidempotentblockhash',
    gasPriceWei: GAS_PRICE_WEI,
    amountUsdt: TICKET_PRICE_USDT,
  };

  const firstCompletion = await completeSweepRecordWithTreasuryMovement(completionInput);
  const repeatedCompletion = await completeSweepRecordWithTreasuryMovement(completionInput);

  assert.equal(firstCompletion.orderMarkedSwept, true);
  assert.equal(repeatedCompletion.orderMarkedSwept, false);
  assert.equal(repeatedCompletion.treasuryLedgerRecord, null);

  const treasuryMovementRows = await pool.query(
    'SELECT * FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(treasuryMovementRows.rows.length, 1);
  assert.equal(treasuryMovementRows.rows[0].tx_hash, '0xidempotentsweephash');

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderRecord.rows[0].status, 'swept');
});

test('sweepSingleOrder finishes an unfinished sweep from its mined receipt without broadcasting again', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];
  const sweepRecord = await createPendingSweepRecord(
    paidOrderRow.order_id,
    paidOrderRow.deposit_address,
    TICKET_PRICE_WEI,
    { treasuryAddress: '0xTreasuryAddress00000000000000000000000000001' }
  );
  await markSweepAsFunded(sweepRecord.id, 0n);
  await markSweepTransactionAsBroadcast(
    sweepRecord.id,
    '0xminedsweepbeforecrash',
    GAS_PRICE_WEI
  );

  let broadcastAttemptCount = 0;
  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: {
      broadcastTransaction: async () => {
        broadcastAttemptCount += 1;
        throw new Error('a second broadcast must never happen');
      },
    },
    fetchUsdtBalance: async () => 0n,
    fetchBnbBalance: async () => 0n,
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => {
      throw new Error('a second signature must never happen');
    },
    fetchTransactionReceipt: async (transactionHash) => ({
      hash: transactionHash,
      gasUsed: TRANSFER_GAS,
      status: 1,
      blockNumber: 777,
      blockHash: '0xrecoveryblockhash777',
    }),
  });

  assert.equal(sweepResult.swept, true);
  assert.equal(sweepResult.recovered, true);
  assert.equal(broadcastAttemptCount, 0);

  const sweepRows = await pool.query('SELECT * FROM sweeps WHERE order_id = $1', [
    createdOrder.id,
  ]);
  assert.equal(sweepRows.rows.length, 1);
  assert.equal(sweepRows.rows[0].status, 'swept');
  assert.equal(sweepRows.rows[0].tx_hash, '0xminedsweepbeforecrash');
  assert.equal(Number(sweepRows.rows[0].block_number), 777);

  const treasuryMovementRows = await pool.query(
    'SELECT * FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(treasuryMovementRows.rows.length, 1);

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderRecord.rows[0].status, 'swept');
});

test('sweepSingleOrder waits for a broadcast sweep whose receipt is not available yet', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];
  const sweepRecord = await createPendingSweepRecord(
    paidOrderRow.order_id,
    paidOrderRow.deposit_address,
    TICKET_PRICE_WEI
  );
  await markSweepAsFunded(sweepRecord.id, 0n);
  await markSweepTransactionAsBroadcast(sweepRecord.id, '0xstillpendinghash', GAS_PRICE_WEI);

  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: {},
    fetchTransactionReceipt: async () => null,
  });

  assert.equal(sweepResult.swept, false);
  assert.equal(sweepResult.reason, 'AWAITING_BROADCAST_CONFIRMATION');

  const sweepRow = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRow.status, 'funded');

  const treasuryMovementRows = await pool.query(
    'SELECT * FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(treasuryMovementRows.rows.length, 0);
});

test('sweepSingleOrder marks a broadcast sweep that reverted on chain as failed', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];
  const sweepRecord = await createPendingSweepRecord(
    paidOrderRow.order_id,
    paidOrderRow.deposit_address,
    TICKET_PRICE_WEI
  );
  await markSweepAsFunded(sweepRecord.id, 0n);
  await markSweepTransactionAsBroadcast(sweepRecord.id, '0xrevertedonchainhash', GAS_PRICE_WEI);

  const sweepResult = await sweepSingleOrder(paidOrderRow, {
    provider: {},
    fetchTransactionReceipt: async (transactionHash) => ({
      hash: transactionHash,
      status: 0,
      blockNumber: 999,
    }),
  });

  assert.equal(sweepResult.swept, false);
  assert.equal(sweepResult.reason, 'SWEEP_REVERTED_ON_CHAIN');

  const sweepRow = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRow.status, 'failed');
  assert.match(sweepRow.failure_reason, /reverted on chain/);

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderRecord.rows[0].status, 'paid');
});

test('finalizeSettledSweepRecords only finalizes swept rows at or below the finalized head', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const sweepRecord = await createPendingSweepRecord(
    createdOrder.id,
    '0xDepositAddress0000000000000000000000000000006',
    TICKET_PRICE_WEI
  );
  await completeSweepRecordWithTreasuryMovement({
    sweepId: sweepRecord.id,
    orderId: createdOrder.id,
    txHash: '0xfinalitysweephash',
    gasUsed: Number(TRANSFER_GAS),
    blockNumber: 200,
    blockHash: '0xfinalitysweepblockhash',
    gasPriceWei: GAS_PRICE_WEI,
    amountUsdt: TICKET_PRICE_USDT,
  });

  const finalizedBeforeHead = await finalizeSettledSweepRecords({
    latestBlockNumber: 300,
    finalizedBlockNumber: 199,
  });
  assert.equal(finalizedBeforeHead, 0);
  assert.equal((await fetchSweepRecordByOrderId(createdOrder.id)).is_finalized, false);

  const finalizedAtHead = await finalizeSettledSweepRecords({
    latestBlockNumber: 300,
    finalizedBlockNumber: 200,
  });
  assert.equal(finalizedAtHead, 1);

  const finalizedSweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(finalizedSweepRecord.status, 'swept');
  assert.equal(finalizedSweepRecord.is_finalized, true);

  const repeatedFinalization = await finalizeSettledSweepRecords({
    latestBlockNumber: 320,
    finalizedBlockNumber: 310,
  });
  assert.equal(repeatedFinalization, 0);
});

test('sweepSingleOrder refuses to fund BNB above the per-sweep sponsorship cap', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];

  let fundingAttemptCount = 0;
  await assert.rejects(
    sweepSingleOrder(paidOrderRow, {
      provider: buildStubProvider(),
      gasWalletSigner: {},
      fetchUsdtBalance: async () => TICKET_PRICE_WEI,
      fetchBnbBalance: async () => 0n,
      fundDepositAddress: async () => {
        fundingAttemptCount += 1;
      },
      fetchGasPrice: async () => GAS_PRICE_WEI,
      signSweepTransaction: async () => '0xserialized',
      fetchDailySponsoredBnbWei: async () => 0n,
      gasSponsorshipLimits: {
        maxBnbPerSweepWei: 1n,
        maxBnbPerCycleWei: ethers.parseEther('1'),
        maxBnbPerDayWei: ethers.parseEther('1'),
      },
    }),
    (sponsorshipError) =>
      sponsorshipError instanceof GasSponsorshipLimitExceededError
      && sponsorshipError.reason === GAS_SPONSORSHIP_PER_SWEEP_LIMIT_EXCEEDED
  );

  assert.equal(fundingAttemptCount, 0);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'failed');
  assert.match(sweepRecord.failure_reason, /PER_SWEEP_LIMIT_EXCEEDED/);

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderRecord.rows[0].status, 'paid');
});

test('sweepSingleOrder refuses to spend beyond the rolling day sponsorship cap', async () => {
  const { createdOrder } = await createSettledPaidOrder();
  const paidOrderRow = (await fetchPaidOrdersEligibleForSweep({ minimumAgeHours: 24 }))[0];

  let fundingAttemptCount = 0;
  await assert.rejects(
    sweepSingleOrder(paidOrderRow, {
      provider: buildStubProvider(),
      gasWalletSigner: {},
      fetchUsdtBalance: async () => TICKET_PRICE_WEI,
      fetchBnbBalance: async () => 0n,
      fundDepositAddress: async () => {
        fundingAttemptCount += 1;
      },
      fetchGasPrice: async () => GAS_PRICE_WEI,
      signSweepTransaction: async () => '0xserialized',
      fetchDailySponsoredBnbWei: async () => ethers.parseEther('0.0005'),
      gasSponsorshipLimits: {
        maxBnbPerSweepWei: ethers.parseEther('0.005'),
        maxBnbPerCycleWei: ethers.parseEther('0.05'),
        maxBnbPerDayWei: ethers.parseEther('0.001'),
      },
    }),
    (sponsorshipError) =>
      sponsorshipError instanceof GasSponsorshipLimitExceededError
      && sponsorshipError.reason === 'DAILY_LIMIT_EXCEEDED'
  );

  assert.equal(fundingAttemptCount, 0);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'failed');
  assert.match(sweepRecord.failure_reason, /DAILY_LIMIT_EXCEEDED/);
});

test('runSweepCycle stops funding when the cycle sponsorship cap is reached', async () => {
  await createSettledPaidOrder();
  await createSettledPaidOrder();

  const perSweepFundingWei =
    ((((GAS_PRICE_WEI * 140n) / 100n) * 65000n) * 120n) / 100n;

  const sweepResults = await runSweepCycle({
    provider: buildStubProvider({ bnbBalanceWei: 0n }),
    gasWalletSigner: {},
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => 0n,
    fundDepositAddress: async () => {},
    fetchGasPrice: async () => GAS_PRICE_WEI,
    signSweepTransaction: async () => '0xserialized',
    fetchSettlementFrontier: async () => SETTLEMENT_FRONTIER_STUB,
    fetchDailySponsoredBnbWei: async () => 0n,
    gasSponsorshipLimits: {
      maxBnbPerSweepWei: ethers.parseEther('0.005'),
      maxBnbPerCycleWei: perSweepFundingWei,
      maxBnbPerDayWei: ethers.parseEther('1'),
    },
    minimumAgeHours: 24,
    alertOnSweepFailure: async () => {},
  });

  assert.equal(sweepResults.length, 2);
  assert.equal(sweepResults[0].swept, true);
  assert.equal(sweepResults[1].swept, false);
  assert.equal(sweepResults[1].reason, 'SWEEP_ERROR');
  assert.match(sweepResults[1].message, new RegExp(GAS_SPONSORSHIP_PER_CYCLE_LIMIT_EXCEEDED));

  const secondOrderSweeps = await pool.query(
    'SELECT status FROM sweeps WHERE order_id = $1',
    [sweepResults[1].orderId]
  );
  assert.equal(secondOrderSweeps.rows.length, 1);
  assert.equal(secondOrderSweeps.rows[0].status, 'failed');

  const secondOrderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [
    sweepResults[1].orderId,
  ]);
  assert.equal(secondOrderRecord.rows[0].status, 'paid');
});
