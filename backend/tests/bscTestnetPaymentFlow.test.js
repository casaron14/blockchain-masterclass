import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import { runUsdtTransferListenerTick } from '../services/monitorService.js';
import { fetchChainSettlementFrontier } from '../services/blockFinalityService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { getUsdtContractAddress, DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';

import { TICKET_PRICE_USDT as SHARED_TICKET_PRICE_USDT } from '../../shared/eventConfig.js';

// Live end-to-end proof of the automatic USDT payment path against the real
// BNB Smart Chain testnet: a real deposit address, a real mock-USDT transfer,
// one real listener tick, and assertions against the database.
//
// It is opt-in and it is NOT hermetic. It broadcasts real transactions on the
// testnet and therefore costs real testnet gas, and the payer has to hold
// testnet BNB. It is skipped unless explicitly enabled:
//
//   RUN_BSC_TESTNET_INTEGRATION=true \
//   DB_DATABASE=masterclass_agent3 \
//   npm run testnet:setup     # once: deploys the mock USDT, writes .env.local
//   node --test --test-force-exit tests/bscTestnetPaymentFlow.test.js
//
// Prerequisites for a live run:
//   * .env.local from local-dev/setupBscTestnet.sh (BSC_RPC_URL,
//     USDT_CONTRACT_ADDRESS, BSC_TESTNET_PAYER_PRIVATE_KEY)
//   * that payer funded with testnet BNB from https://www.bnbchain.org/faucet
//     (the transfer costs gas; with 0 BNB the run fails on the send, which is
//     exactly why the test skips by default)
//   * a dedicated database, never `masterclass`: every test TRUNCATEs bookings.

const LIVE_TESTNET_RUN_ENABLED = process.env.RUN_BSC_TESTNET_INTEGRATION === 'true';
const SKIP_REASON =
  'Live BSC testnet run disabled. Enable it with RUN_BSC_TESTNET_INTEGRATION=true ' +
  '(after "npm run testnet:setup", with the testnet payer funded with testnet BNB, ' +
  'and a dedicated DB_DATABASE such as masterclass_agent3).';

const MOCK_USDT_ABI = [
  'function mint(address to, uint256 amount) external',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

// A BSC block is produced every ~0.75s and the `finalized` head trails the head
// by a few blocks, so a transfer mined a moment ago is NOT settled yet. Waiting
// for the settlement frontier to pass the transfer block is what makes "one
// listener tick confirms it" a deterministic assertion instead of a race: the
// tick under test is the one that has a settled deposit to act on.
const SETTLEMENT_FRONTIER_POLL_INTERVAL_MS = 2000;
const SETTLEMENT_FRONTIER_TIMEOUT_MS = 180_000;

let bscTestnetProvider;
let testnetPayerWallet;
let mockUsdtContract;
let nextPayerNonce = null;

function delay(durationMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function resolvePayerNonce() {
  if (nextPayerNonce === null) {
    return bscTestnetProvider
      .getTransactionCount(testnetPayerWallet.address, 'pending')
      .then((pendingNonce) => {
        nextPayerNonce = pendingNonce;
        return nextPayerNonce;
      });
  }
  const reservedNonce = nextPayerNonce;
  nextPayerNonce += 1;
  return Promise.resolve(reservedNonce);
}

async function resetLiveTestDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
  await pool.query('UPDATE usdt_transfer_scan_state SET last_scanned_block = 0, last_finalized_block = 0');
}

async function createUsdtBookingWithDepositAddress(attendeeSuffix) {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: `Testnet Attendee ${attendeeSuffix}`,
    email: `testnet-${attendeeSuffix}@example.com`,
    phone_number: `+25571234${String(1000 + Number(attendeeSuffix)).slice(-4)}`,
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'usdt_bep20'
  );
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

  return { bookingRecord, paymentRecord, createdOrder };
}

// Mints (when the payer is short) and transfers exactly `transferAmountUsdt` of
// the testnet token to the deposit address, using explicit nonces so the mint
// and the transfer can never collide in the mempool.
async function transferMockUsdtToDepositAddress(depositAddress, transferAmountUsdt) {
  const transferAmountWei = ethers.parseUnits(String(transferAmountUsdt), DEFAULT_USDT_DECIMALS);
  const payerTokenBalanceWei = await mockUsdtContract.balanceOf(testnetPayerWallet.address);

  if (payerTokenBalanceWei < transferAmountWei) {
    const mintNonce = await resolvePayerNonce();
    await (
      await mockUsdtContract.mint(testnetPayerWallet.address, transferAmountWei, { nonce: mintNonce })
    ).wait();
  }

  const transferNonce = await resolvePayerNonce();
  const transferReceipt = await (
    await mockUsdtContract.transfer(depositAddress, transferAmountWei, { nonce: transferNonce })
  ).wait();

  assert.ok(transferReceipt.blockNumber > 0, 'the testnet transfer was never mined');
  assert.equal(transferReceipt.status, 1, 'the testnet transfer reverted on chain');

  const depositBalanceWei = await mockUsdtContract.balanceOf(depositAddress);
  assert.equal(
    depositBalanceWei,
    transferAmountWei,
    'the deposit address does not hold the amount that was sent on chain'
  );

  return transferReceipt;
}

async function waitUntilTransferBlockIsSettled(transferBlockNumber) {
  const settlementDeadline = Date.now() + SETTLEMENT_FRONTIER_TIMEOUT_MS;

  while (Date.now() < settlementDeadline) {
    const settlementFrontier = await fetchChainSettlementFrontier(bscTestnetProvider);
    if (settlementFrontier.finalizedBlockNumber >= transferBlockNumber) {
      return settlementFrontier;
    }
    await delay(SETTLEMENT_FRONTIER_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Block ${transferBlockNumber} never reached the settlement frontier ` +
      `(last finalized head was below it after ${SETTLEMENT_FRONTIER_TIMEOUT_MS}ms). ` +
      'The testnet is not finalizing, or the RPC does not serve the finalized tag.'
  );
}

async function fetchPaymentRecordForBooking(bookingId) {
  const paymentResult = await pool.query(
    'SELECT * FROM payments WHERE booking_id = $1',
    [bookingId]
  );
  return paymentResult.rows[0] ?? null;
}

async function fetchBookingStatus(bookingId) {
  const bookingResult = await pool.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
  return bookingResult.rows[0]?.status ?? null;
}

async function fetchPaymentReceiptRowsForPayment(paymentId) {
  const receiptResult = await pool.query(
    'SELECT * FROM payment_receipts WHERE payment_id = $1 ORDER BY id ASC',
    [paymentId]
  );
  return receiptResult.rows;
}

async function fetchBlockchainTransactionRowsForPayment(paymentId) {
  const transactionResult = await pool.query(
    'SELECT * FROM blockchain_transactions WHERE payment_id = $1 ORDER BY id ASC',
    [paymentId]
  );
  return transactionResult.rows;
}

async function fetchObservedDepositRowsForOrder(orderId) {
  const depositResult = await pool.query(
    'SELECT * FROM deposits_observed WHERE order_id = $1 ORDER BY id ASC',
    [orderId]
  );
  return depositResult.rows;
}

before(async () => {
  if (!LIVE_TESTNET_RUN_ENABLED) {
    return;
  }

  assert.ok(
    process.env.BSC_TESTNET_PAYER_PRIVATE_KEY,
    'BSC_TESTNET_PAYER_PRIVATE_KEY is missing. Run "npm run testnet:setup" first.'
  );

  bscTestnetProvider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL, undefined, {
    staticNetwork: true,
  });
  testnetPayerWallet = new ethers.Wallet(process.env.BSC_TESTNET_PAYER_PRIVATE_KEY, bscTestnetProvider);
  mockUsdtContract = new ethers.Contract(getUsdtContractAddress(), MOCK_USDT_ABI, testnetPayerWallet);

  const connectedNetwork = await bscTestnetProvider.getNetwork();
  assert.equal(
    connectedNetwork.chainId,
    97n,
    `BSC_RPC_URL reports chain ${connectedNetwork.chainId}, not the BSC testnet (97). ` +
      'Run "npm run testnet:setup" first.'
  );

  const tokenBytecode = await bscTestnetProvider.getCode(getUsdtContractAddress());
  assert.notEqual(
    tokenBytecode,
    '0x',
    'The configured USDT_CONTRACT_ADDRESS has no code on the testnet. Run "npm run testnet:setup" first.'
  );

  await resetLiveTestDatabaseState();
});

beforeEach(resetLiveTestDatabaseState);

after(async () => {
  if (!LIVE_TESTNET_RUN_ENABLED) {
    return;
  }
  // A run that died half way through must not poison the next run: the listener
  // cursor is global, so a stale watermark would hide the next test's transfer.
  await resetLiveTestDatabaseState();
  await pool.end();
});

test(
  'one listener tick settles an exact-price transfer: confirmed payment, confirmed booking, receipt row and a finalized deposit',
  { skip: !LIVE_TESTNET_RUN_ENABLED && SKIP_REASON },
  async () => {
    assert.equal(SHARED_TICKET_PRICE_USDT, 3.8, 'the shared ticket price changed; update this test');

    const { bookingRecord, paymentRecord, createdOrder } =
      await createUsdtBookingWithDepositAddress('01');

    assert.equal(
      Number(paymentRecord.amount_expected),
      SHARED_TICKET_PRICE_USDT,
      'the created payment does not expect the shared ticket price'
    );

    const transferReceipt = await transferMockUsdtToDepositAddress(
      createdOrder.deposit_address,
      SHARED_TICKET_PRICE_USDT
    );
    await waitUntilTransferBlockIsSettled(transferReceipt.blockNumber);

    const tickSummary = await runUsdtTransferListenerTick();

    assert.equal(
      tickSummary.matchedTransferCount,
      1,
      'the listener did not attribute the testnet transfer to the deposit address'
    );
    assert.ok(
      tickSummary.confirmationResults.some(
        (confirmationResult) =>
          confirmationResult.orderId === createdOrder.id && confirmationResult.confirmed === true
      ),
      `the listener did not confirm order ${createdOrder.id}: ${JSON.stringify(
        tickSummary.confirmationResults
      )}`
    );

    const confirmedPaymentRecord = await fetchPaymentRecordForBooking(bookingRecord.id);
    assert.equal(confirmedPaymentRecord.status, 'confirmed');
    assert.equal(confirmedPaymentRecord.tx_hash, transferReceipt.hash);
    assert.ok(confirmedPaymentRecord.confirmed_at, 'the confirmed payment has no confirmed_at');

    assert.equal(await fetchBookingStatus(bookingRecord.id), 'confirmed');

    const paidOrderResult = await pool.query('SELECT status FROM orders WHERE id = $1', [createdOrder.id]);
    assert.equal(paidOrderResult.rows[0].status, 'paid');

    const receiptRows = await fetchPaymentReceiptRowsForPayment(paymentRecord.id);
    assert.equal(receiptRows.length, 1, 'expected exactly one payment_receipts row');
    assert.equal(receiptRows[0].tx_hash, transferReceipt.hash);
    assert.equal(receiptRows[0].deposit_address, createdOrder.deposit_address);

    const observedDepositRows = await fetchObservedDepositRowsForOrder(createdOrder.id);
    assert.equal(observedDepositRows.length, 1, 'expected exactly one deposits_observed row');
    assert.equal(observedDepositRows[0].is_finalized, true, 'the settled deposit was not marked finalized');
    assert.equal(observedDepositRows[0].block_hash.toLowerCase(), transferReceipt.blockHash.toLowerCase());
  }
);

test(
  'an underpaid transfer is recorded but never confirmed by a listener tick',
  { skip: !LIVE_TESTNET_RUN_ENABLED && SKIP_REASON },
  async () => {
    const underpaidAmountUsdt = SHARED_TICKET_PRICE_USDT - 1;
    const { bookingRecord, paymentRecord, createdOrder } =
      await createUsdtBookingWithDepositAddress('02');

    const transferReceipt = await transferMockUsdtToDepositAddress(
      createdOrder.deposit_address,
      underpaidAmountUsdt
    );
    // The amount guard is the subject of this test, so the deposit has to be
    // settled first: otherwise "not confirmed" would only prove that finality
    // had not arrived yet.
    await waitUntilTransferBlockIsSettled(transferReceipt.blockNumber);

    const tickSummary = await runUsdtTransferListenerTick();

    assert.ok(
      tickSummary.confirmationResults.every(
        (confirmationResult) => confirmationResult.orderId !== createdOrder.id || confirmationResult.confirmed !== true
      ),
      'an underpaid payment was confirmed by the listener'
    );

    const underpaidPaymentRecord = await fetchPaymentRecordForBooking(bookingRecord.id);
    assert.notEqual(underpaidPaymentRecord.status, 'confirmed', 'an underpaid payment was marked confirmed');
    assert.equal(underpaidPaymentRecord.status, 'pending');
    assert.equal(await fetchBookingStatus(bookingRecord.id), 'pending');

    assert.equal(
      (await fetchPaymentReceiptRowsForPayment(paymentRecord.id)).length,
      0,
      'an underpaid payment produced a receipt'
    );

    const underpaidDepositRows = await fetchObservedDepositRowsForOrder(createdOrder.id);
    assert.equal(underpaidDepositRows.length, 1, 'the underpaid transfer was not recorded at all');
    assert.equal(
      underpaidDepositRows[0].is_finalized,
      true,
      'the underpaid deposit should still be finalized on chain; only the amount is short'
    );

    // The hold is still live here, so nothing is flagged for review yet.
    const reviewFlagResult = await pool.query(
      'SELECT * FROM payment_review_flags WHERE payment_id = $1',
      [paymentRecord.id]
    );
    assert.equal(reviewFlagResult.rows.length, 0, 'a live hold must not be flagged for review');
  }
);

test(
  'a payer who sends to an expired order is still settled: the payment is confirmed and the seat is granted',
  { skip: !LIVE_TESTNET_RUN_ENABLED && SKIP_REASON },
  async () => {
    const { bookingRecord, paymentRecord, createdOrder } =
      await createUsdtBookingWithDepositAddress('03');

    // The stranded-payer case: the hold lapsed before the money landed. The
    // deposit address stays in the listener's confirmable set (WATCHABLE_ORDER
    // STATUSES includes 'expired'), so the late money is settled rather than
    // stranded. The booking hold itself is still inside its 60-minute window,
    // so a seat can still be granted.
    const orderExpiryResult = await pool.query(
      `UPDATE orders
          SET status = 'expired',
              expires_at = now() - interval '1 minute'
        WHERE id = $1
        RETURNING status, expires_at`,
      [createdOrder.id]
    );
    assert.equal(orderExpiryResult.rows[0].status, 'expired');

    const transferReceipt = await transferMockUsdtToDepositAddress(
      createdOrder.deposit_address,
      SHARED_TICKET_PRICE_USDT
    );
    await waitUntilTransferBlockIsSettled(transferReceipt.blockNumber);

    const tickSummary = await runUsdtTransferListenerTick();

    const latePaymentOutcome = tickSummary.confirmationResults.find(
      (confirmationResult) => confirmationResult.orderId === createdOrder.id
    );
    assert.equal(
      latePaymentOutcome?.confirmed,
      true,
      `a payment to an expired order was not settled: ${JSON.stringify(tickSummary.confirmationResults)}`
    );

    const latePaymentRecord = await fetchPaymentRecordForBooking(bookingRecord.id);
    assert.equal(latePaymentRecord.status, 'confirmed', 'the late payment was not confirmed');
    assert.equal(latePaymentRecord.tx_hash, transferReceipt.hash);

    assert.equal(
      await fetchBookingStatus(bookingRecord.id),
      'confirmed',
      'the late payment did not grant the seat the attendee had already paid for'
    );

    const latePaymentReceiptRows = await fetchPaymentReceiptRowsForPayment(paymentRecord.id);
    assert.equal(latePaymentReceiptRows.length, 1, 'the settled late payment produced no receipt');
    assert.equal(latePaymentReceiptRows[0].tx_hash, transferReceipt.hash);

    // It was settled, not parked, so nothing needs a human decision.
    const latePaymentReviewFlags = await pool.query(
      'SELECT * FROM payment_review_flags WHERE payment_id = $1',
      [paymentRecord.id]
    );
    assert.equal(
      latePaymentReviewFlags.rows.length,
      0,
      'a settled late payment must not also be parked for review'
    );
  }
);

test(
  'a second listener tick after confirmation is a no-op: one receipt, one blockchain transaction, one observed deposit',
  { skip: !LIVE_TESTNET_RUN_ENABLED && SKIP_REASON },
  async () => {
    const { bookingRecord, paymentRecord, createdOrder } =
      await createUsdtBookingWithDepositAddress('04');

    const transferReceipt = await transferMockUsdtToDepositAddress(
      createdOrder.deposit_address,
      SHARED_TICKET_PRICE_USDT
    );
    await waitUntilTransferBlockIsSettled(transferReceipt.blockNumber);

    const firstTickSummary = await runUsdtTransferListenerTick();
    assert.ok(
      firstTickSummary.confirmationResults.some(
        (confirmationResult) =>
          confirmationResult.orderId === createdOrder.id && confirmationResult.confirmed === true
      ),
      `the first listener tick did not confirm the payment: ${JSON.stringify(
        firstTickSummary.confirmationResults
      )}`
    );

    assert.equal((await fetchPaymentReceiptRowsForPayment(paymentRecord.id)).length, 1);
    assert.equal((await fetchBlockchainTransactionRowsForPayment(paymentRecord.id)).length, 1);
    assert.equal((await fetchObservedDepositRowsForOrder(createdOrder.id)).length, 1);

    const secondTickSummary = await runUsdtTransferListenerTick();

    assert.equal(
      secondTickSummary.confirmedCount,
      0,
      `a second tick confirmed something again: ${JSON.stringify(secondTickSummary.confirmationResults)}`
    );
    assert.equal(
      secondTickSummary.recordedTransferCount,
      0,
      'a second tick re-recorded a transfer it had already recorded'
    );

    assert.equal(
      (await fetchPaymentRecordForBooking(bookingRecord.id)).status,
      'confirmed',
      'the payment stopped being confirmed after a second tick'
    );
    assert.equal(
      (await fetchPaymentReceiptRowsForPayment(paymentRecord.id)).length,
      1,
      'a second tick produced a duplicate payment_receipts row'
    );
    assert.equal(
      (await fetchBlockchainTransactionRowsForPayment(paymentRecord.id)).length,
      1,
      'a second tick produced a duplicate blockchain_transactions row'
    );
    assert.equal(
      (await fetchObservedDepositRowsForOrder(createdOrder.id)).length,
      1,
      'a second tick produced a duplicate deposits_observed row'
    );
  }
);