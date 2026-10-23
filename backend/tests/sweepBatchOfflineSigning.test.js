import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import { prepareSweepBatchForOfflineSigning } from '../services/sweepBatchPreparationService.js';
import { signPreparedSweepBatchWithMasterMnemonic } from '../services/offlineSweepSigningService.js';
import { submitSignedSweepBatch } from '../services/sweepBatchSubmissionService.js';
import { fetchSweepRecordByOrderId } from '../services/sweepService.js';

import {
  createOrderWithDepositAddressForBooking,
  updateOrderStatus,
} from '../services/orderService.js';

import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
  updatePaymentRecordStatus,
} from '../services/paymentService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

import { createDerivedWalletForDerivationIndex } from '../services/signingService.js';

import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

const TICKET_PRICE_USDT = 3.8;
const TICKET_PRICE_WEI = ethers.parseUnits(String(TICKET_PRICE_USDT), DEFAULT_USDT_DECIMALS);
const GAS_PRICE_WEI = ethers.parseUnits('5', 'gwei');

const USDT_TRANSFER_INTERFACE = new ethers.Interface([
  'function transfer(address to, uint256 value)',
]);

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createSettledPaidOrder() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Offline Sweep User',
    email: 'offline-sweep@example.com',
    phone_number: '+255712345676',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  await updateOrderStatus(createdOrder.id, 'paid');

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');
  await pool.query(
    "UPDATE payments SET confirmed_at = now() - interval '48 hours' WHERE id = $1",
    [paymentRecord.id]
  );

  return createdOrder;
}

function buildStubProvider({ receiptStatus = 1 } = {}) {
  const broadcastRawTransactions = [];
  let currentTransactionCount = 0;

  return {
    broadcastRawTransactions,
    setTransactionCount(nextTransactionCount) {
      currentTransactionCount = nextTransactionCount;
    },
    getNetwork: async () => ({ chainId: 56 }),
    getTransactionCount: async () => currentTransactionCount,
    getTransactionReceipt: async () => null,
    broadcastTransaction: async (rawTransaction) => {
      broadcastRawTransactions.push(rawTransaction);
      const parsedTransaction = ethers.Transaction.from(rawTransaction);
      return {
        hash: parsedTransaction.hash,
        wait: async () => ({
          hash: parsedTransaction.hash,
          gasUsed: 52000n,
          status: receiptStatus,
          blockNumber: 4321,
          blockHash: '0xbatchsweepblockhash',
        }),
      };
    },
  };
}

function buildPreparationDependencies(provider) {
  return {
    provider,
    gasWalletSigner: {},
    minimumAgeHours: 24,
    fetchUsdtBalance: async () => TICKET_PRICE_WEI,
    fetchBnbBalance: async () => 0n,
    fundDepositAddress: async () => {},
    fetchGasPrice: async () => GAS_PRICE_WEI,
    fetchTransactionReceipt: async () => null,
    fetchDailySponsoredBnbWei: async () => 0n,
  };
}

function buildSubmissionDependencies(provider) {
  return {
    provider,
    fetchTransactionReceipt: async () => null,
  };
}

test('prepare -> sign -> submit collects an order and records the ledger once', async () => {
  const createdOrder = await createSettledPaidOrder();
  const provider = buildStubProvider();

  const preparedBatch = await prepareSweepBatchForOfflineSigning(
    buildPreparationDependencies(provider)
  );

  assert.equal(preparedBatch.items.length, 1);
  assert.equal(preparedBatch.results[0].status, 'PREPARED_FOR_OFFLINE_SIGNING');
  assert.equal(preparedBatch.items[0].orderId, createdOrder.id);
  assert.equal(preparedBatch.items[0].depositAddress, createdOrder.deposit_address);
  assert.equal(preparedBatch.items[0].nonce, 0);
  assert.ok(preparedBatch.items[0].attempts.length >= 1);
  assert.match(preparedBatch.items[0].attempts[0].unsignedTransaction, /^0x/);

  const preparedSweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(preparedSweepRecord.status, 'funded');
  assert.equal(preparedSweepRecord.tx_hash, null);

  const signedBatch = await signPreparedSweepBatchWithMasterMnemonic(preparedBatch);
  assert.equal(signedBatch.items.length, 1);
  for (const signedAttempt of signedBatch.items[0].attempts) {
    const signedTransaction = ethers.Transaction.from(signedAttempt.rawTransaction);
    assert.equal(
      signedTransaction.from.toLowerCase(),
      createdOrder.deposit_address.toLowerCase()
    );
  }

  const submissionSummary = await submitSignedSweepBatch(
    signedBatch,
    buildSubmissionDependencies(provider)
  );

  assert.equal(submissionSummary.results[0].status, 'SWEPT');
  assert.equal(provider.broadcastRawTransactions.length, 1);

  const orderRecord = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderRecord.rows[0].status, 'swept');

  const sweptSweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweptSweepRecord.status, 'swept');
  assert.ok(sweptSweepRecord.tx_hash);

  const ledgerRows = await pool.query(
    'SELECT amount, tx_hash FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(ledgerRows.rowCount, 1);
  assert.equal(Number(ledgerRows.rows[0].amount), TICKET_PRICE_USDT);
});

test('submitting the same signed batch twice does not move the balance twice', async () => {
  const createdOrder = await createSettledPaidOrder();
  const provider = buildStubProvider();

  const preparedBatch = await prepareSweepBatchForOfflineSigning(
    buildPreparationDependencies(provider)
  );
  const signedBatch = await signPreparedSweepBatchWithMasterMnemonic(preparedBatch);

  const firstSubmission = await submitSignedSweepBatch(
    signedBatch,
    buildSubmissionDependencies(provider)
  );
  const replaySubmission = await submitSignedSweepBatch(
    signedBatch,
    buildSubmissionDependencies(provider)
  );

  assert.equal(firstSubmission.results[0].status, 'SWEPT');
  assert.equal(replaySubmission.results[0].status, 'ALREADY_COMPLETED');
  assert.equal(provider.broadcastRawTransactions.length, 1);

  const ledgerRows = await pool.query(
    'SELECT tx_hash FROM treasury_ledger WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(ledgerRows.rowCount, 1);
});

test('signing with a key that does not match the deposit address is refused', async () => {
  await createSettledPaidOrder();
  const preparedBatch = await prepareSweepBatchForOfflineSigning(
    buildPreparationDependencies(buildStubProvider())
  );

  await assert.rejects(
    () =>
      signPreparedSweepBatchWithMasterMnemonic(preparedBatch, {
        deriveWallet: () => ethers.Wallet.createRandom(),
      }),
    /do not belong to the same seed/
  );
});

test('a signed batch that moves a different amount is rejected before broadcast', async () => {
  const createdOrder = await createSettledPaidOrder();
  const provider = buildStubProvider();

  const preparedBatch = await prepareSweepBatchForOfflineSigning(
    buildPreparationDependencies(provider)
  );
  const signedBatch = await signPreparedSweepBatchWithMasterMnemonic(preparedBatch);

  const tamperedBatch = structuredClone(signedBatch);
  const tamperedItem = tamperedBatch.items[0];
  const tamperedWallet = createDerivedWalletForDerivationIndex(
    tamperedItem.derivationIndex
  );
  const tamperedTransaction = {
    chainId: 56,
    nonce: tamperedItem.nonce,
    gasPrice: BigInt(tamperedItem.attempts[0].gasPriceWei),
    gasLimit: tamperedItem.gasLimit,
    to: tamperedBatch.network.usdtContractAddress,
    value: 0n,
    data: USDT_TRANSFER_INTERFACE.encodeFunctionData('transfer', [
      tamperedBatch.network.treasuryAddress,
      1n,
    ]),
  };
  tamperedItem.attempts[0] = {
    gasPriceWei: tamperedItem.attempts[0].gasPriceWei,
    rawTransaction: await tamperedWallet.signTransaction(tamperedTransaction),
    transactionHash: ethers.Transaction.from(tamperedTransaction).hash,
  };

  await assert.rejects(
    () => submitSignedSweepBatch(tamperedBatch, buildSubmissionDependencies(provider)),
    /sends 1, expected/
  );
  assert.equal(provider.broadcastRawTransactions.length, 0);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'funded');
});

test('a batch prepared for a nonce that has moved is refused as stale', async () => {
  const createdOrder = await createSettledPaidOrder();
  const provider = buildStubProvider();

  const preparedBatch = await prepareSweepBatchForOfflineSigning(
    buildPreparationDependencies(provider)
  );
  const signedBatch = await signPreparedSweepBatchWithMasterMnemonic(preparedBatch);
  provider.setTransactionCount(1);

  await assert.rejects(
    () => submitSignedSweepBatch(signedBatch, buildSubmissionDependencies(provider)),
    /The batch is stale/
  );
  assert.equal(provider.broadcastRawTransactions.length, 0);

  const sweepRecord = await fetchSweepRecordByOrderId(createdOrder.id);
  assert.equal(sweepRecord.status, 'funded');
});
