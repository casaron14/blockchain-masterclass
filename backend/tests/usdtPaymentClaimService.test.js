import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  USDT_CLAIM_ALREADY_CONFIRMED,
  USDT_CLAIM_TRANSACTION_NOT_FOUND,
  USDT_CLAIM_TRANSFER_NOT_FOR_THIS_BOOKING,
  verifyClaimedUsdtTransferForBooking,
} from '../services/usdtPaymentClaimService.js';

import {
  DEFAULT_USDT_DECIMALS,
  USDT_BEP20_ABI,
  getUsdtContractAddress,
} from '../services/usdtPaymentService.js';

import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
} from '../services/paymentService.js';

import {
  createBookingRecordWithActiveSeatHold,
  fetchEventAvailabilitySnapshot,
} from '../services/bookingService.js';

import {
  createOrderWithDepositAddressForBooking,
  fetchDepositAddressRecordsForOrderId,
} from '../services/orderService.js';

const TICKET_PRICE_WEI = ethers.parseUnits('3.8', DEFAULT_USDT_DECIMALS);
const PAYER_ADDRESS = '0x1111111111111111111111111111111111111111';
const UNRELATED_ADDRESS = '0x2222222222222222222222222222222222222222';

const usdtInterface = new ethers.Interface(USDT_BEP20_ABI);

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createPendingUsdtBookingWithDepositAddress() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'USDT Claim User',
    email: 'usdt-claim@example.com',
    phone_number: '+255712345699',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  const depositAddressRecords = await fetchDepositAddressRecordsForOrderId(createdOrder.id);
  return { bookingRecord, createdOrder, depositAddressRecords };
}

function buildUsdtTransferLog({ toAddress, amountWei, logIndex = 0 }) {
  const encodedLog = usdtInterface.encodeEventLog('Transfer', [
    PAYER_ADDRESS,
    toAddress,
    amountWei,
  ]);
  return {
    address: getUsdtContractAddress(),
    topics: encodedLog.topics,
    data: encodedLog.data,
    index: logIndex,
  };
}

function buildTransactionReceipt({ txHash, blockNumber, logs }) {
  return {
    hash: txHash,
    blockNumber,
    blockHash: `0xblockhash${blockNumber}`,
    status: 1,
    logs,
  };
}

function buildSettlementFrontierStub(blockNumber, { finalized }) {
  return async () => ({
    latestBlockNumber: blockNumber + 20,
    finalizedBlockNumber: finalized ? blockNumber + 10 : blockNumber - 1,
    settledBy: 'depth',
  });
}

function buildClaimDependencies({ transactionReceipt, settlementFrontier }) {
  return {
    provider: { getNetwork: async () => ({ chainId: 97n }) },
    fetchTransactionReceipt: async () => transactionReceipt,
    fetchSettlementFrontier: settlementFrontier,
    deliverTicket: async () => ({ delivered: true }),
    deliverReceiptEmail: async () => ({ delivered: true }),
  };
}

test('a claimed transaction that pays an unrelated address is not recorded as this booking payment', async () => {
  const { bookingRecord, createdOrder } = await createPendingUsdtBookingWithDepositAddress();
  const transactionHash = '0xclaimwrongaddress0000000000000000000000000000000000000001';
  const transactionReceipt = buildTransactionReceipt({
    txHash: transactionHash,
    blockNumber: 100,
    logs: [
      buildUsdtTransferLog({
        toAddress: UNRELATED_ADDRESS,
        amountWei: TICKET_PRICE_WEI,
      }),
    ],
  });

  const claimResult = await verifyClaimedUsdtTransferForBooking(
    bookingRecord.id,
    transactionHash,
    buildClaimDependencies({
      transactionReceipt,
      settlementFrontier: buildSettlementFrontierStub(100, { finalized: true }),
    })
  );

  assert.equal(claimResult.confirmed, false);
  assert.equal(claimResult.reason, USDT_CLAIM_TRANSFER_NOT_FOR_THIS_BOOKING);
  assert.equal(claimResult.scannedTransferCount, 1);

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(paymentRecord.status, 'pending');
  assert.equal(paymentRecord.tx_hash, null);

  const observedDepositRows = await pool.query(
    'SELECT id FROM deposits_observed WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(observedDepositRows.rows.length, 0);

  const recordedErrorRows = await pool.query(
    'SELECT id FROM blockchain_transaction_errors WHERE tx_hash = $1',
    [transactionHash]
  );
  assert.equal(recordedErrorRows.rows.length, 0);
});

test('a claimed transaction that has not reached finality is recorded but leaves the payment pending', async () => {
  const { bookingRecord, createdOrder, depositAddressRecords } =
    await createPendingUsdtBookingWithDepositAddress();
  const transactionHash = '0xclaimnotfinalized000000000000000000000000000000000000002';
  const transactionReceipt = buildTransactionReceipt({
    txHash: transactionHash,
    blockNumber: 200,
    logs: [
      buildUsdtTransferLog({
        toAddress: depositAddressRecords[0].address,
        amountWei: TICKET_PRICE_WEI,
      }),
    ],
  });

  const claimResult = await verifyClaimedUsdtTransferForBooking(
    bookingRecord.id,
    transactionHash,
    buildClaimDependencies({
      transactionReceipt,
      settlementFrontier: buildSettlementFrontierStub(200, { finalized: false }),
    })
  );

  assert.equal(claimResult.confirmed, false);
  assert.equal(claimResult.reason, 'NOT_FINALIZED_YET');
  assert.equal(claimResult.observedAmountUsdt, 3.8);

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(paymentRecord.status, 'pending');

  const observedDepositRows = await pool.query(
    'SELECT * FROM deposits_observed WHERE order_id = $1',
    [createdOrder.id]
  );
  assert.equal(observedDepositRows.rows.length, 1);
  assert.equal(observedDepositRows.rows[0].is_finalized, false);
  assert.equal(observedDepositRows.rows[0].tx_hash, transactionHash);
});

test('a finalized claimed transaction confirms the payment through the shared settlement path', async () => {
  const { bookingRecord, createdOrder, depositAddressRecords } =
    await createPendingUsdtBookingWithDepositAddress();
  const transactionHash = '0xclaimfinalized00000000000000000000000000000000000000003';
  const transactionReceipt = buildTransactionReceipt({
    txHash: transactionHash,
    blockNumber: 300,
    logs: [
      buildUsdtTransferLog({
        toAddress: depositAddressRecords[0].address,
        amountWei: TICKET_PRICE_WEI,
      }),
    ],
  });

  const claimResult = await verifyClaimedUsdtTransferForBooking(
    bookingRecord.id,
    transactionHash,
    buildClaimDependencies({
      transactionReceipt,
      settlementFrontier: buildSettlementFrontierStub(300, { finalized: true }),
    })
  );

  assert.equal(claimResult.confirmed, true);
  assert.equal(claimResult.seatConfirmed, true);
  assert.equal(claimResult.claim.matchedTransferCount, 1);
  assert.equal(claimResult.claim.claimedAmountUsdt, 3.8);

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(paymentRecord.status, 'confirmed');
  assert.equal(paymentRecord.tx_hash, transactionHash);

  const bookingStatus = await pool.query('SELECT status FROM bookings WHERE id = $1', [
    bookingRecord.id,
  ]);
  assert.equal(bookingStatus.rows[0].status, 'confirmed');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 1);

  const recordedTransactionRows = await pool.query(
    'SELECT * FROM blockchain_transactions WHERE tx_hash = $1',
    [transactionHash]
  );
  assert.equal(recordedTransactionRows.rows.length, 1);
  assert.equal(
    recordedTransactionRows.rows[0].to_address.toLowerCase(),
    depositAddressRecords[0].address.toLowerCase()
  );

  const sweepCandidateRows = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(sweepCandidateRows.rows[0].status, 'paid');
});

test('a second claim for an already confirmed booking reports that the payment is already confirmed', async () => {
  const { bookingRecord, depositAddressRecords } = await createPendingUsdtBookingWithDepositAddress();
  const transactionHash = '0xclaimalreadyconfirmed000000000000000000000000000000000004';
  const transactionReceipt = buildTransactionReceipt({
    txHash: transactionHash,
    blockNumber: 400,
    logs: [
      buildUsdtTransferLog({
        toAddress: depositAddressRecords[0].address,
        amountWei: TICKET_PRICE_WEI,
      }),
    ],
  });

  const firstClaimResult = await verifyClaimedUsdtTransferForBooking(
    bookingRecord.id,
    transactionHash,
    buildClaimDependencies({
      transactionReceipt,
      settlementFrontier: buildSettlementFrontierStub(400, { finalized: true }),
    })
  );
  assert.equal(firstClaimResult.confirmed, true);

  const repeatedClaimResult = await verifyClaimedUsdtTransferForBooking(
    bookingRecord.id,
    transactionHash,
    buildClaimDependencies({
      transactionReceipt,
      settlementFrontier: buildSettlementFrontierStub(400, { finalized: true }),
    })
  );

  assert.equal(repeatedClaimResult.confirmed, true);
  assert.equal(repeatedClaimResult.alreadyConfirmed, true);
  assert.equal(repeatedClaimResult.reason, USDT_CLAIM_ALREADY_CONFIRMED);

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 1);
});

test('a transaction hash the node does not know yet is reported without touching the payment', async () => {
  const { bookingRecord } = await createPendingUsdtBookingWithDepositAddress();

  const claimResult = await verifyClaimedUsdtTransferForBooking(
    bookingRecord.id,
    '0xclaimunknowntransaction0000000000000000000000000000000005',
    buildClaimDependencies({
      transactionReceipt: null,
      settlementFrontier: buildSettlementFrontierStub(500, { finalized: true }),
    })
  );

  assert.equal(claimResult.confirmed, false);
  assert.equal(claimResult.reason, USDT_CLAIM_TRANSACTION_NOT_FOUND);

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(paymentRecord.status, 'pending');
});
