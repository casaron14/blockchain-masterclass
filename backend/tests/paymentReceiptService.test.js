import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';

import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  createPaymentReceiptRecordForConfirmedPayment,
  resolveActiveChainId,
  fetchPaymentReceiptByBookingId,
  fetchPaymentReceiptByPaymentId,
  fetchPaymentReceiptsAwaitingDelivery,
  markPaymentReceiptIssued,
  markPaymentReceiptFailed,
  buildPaymentReceiptPdfForConfirmedPayment,
  buildPaymentReceiptPdfArtifactForBooking,
  deliverPaymentReceiptEmailToAttendee,
  sumObservedDepositAmountWei,
  formatUsdtAmountWeiAsDecimalString,
  resolvePaymentReceiptsDirectory,
} from '../services/paymentReceiptService.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
} from '../services/bookingService.js';

import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';

const USDT_DECIMAL_PRECISION = 18;
const ORIGINAL_CHAIN_ID = process.env.CHAIN_ID;
const ORIGINAL_BSC_RPC_URL = process.env.BSC_RPC_URL;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createConfirmedUsdtBookingWithOrder() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Receipt Attendee',
    email: 'receipt-attendee@example.com',
    phone_number: '+255712345698',
  });
  await confirmBookingSeatWithinCapacity(bookingRecord.id);

  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'usdt_bep20'
  );
  await pool.query(
    `UPDATE payments SET status = 'confirmed', confirmed_at = now(), wallet_address = $2 WHERE id = $1`,
    [paymentRecord.id, '0xDepositAddressForReceipt']
  );
  const confirmedPaymentResult = await pool.query(
    'SELECT * FROM payments WHERE id = $1',
    [paymentRecord.id]
  );

  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);

  return {
    bookingRecord: { ...bookingRecord, id: Number(bookingRecord.id) },
    paymentRecord: {
      ...confirmedPaymentResult.rows[0],
      id: Number(confirmedPaymentResult.rows[0].id),
    },
    orderRecord: { ...orderResult.rows[0], id: Number(orderResult.rows[0].id) },
    depositAddress: createdOrder.deposit_address,
  };
}

function buildObservedDeposit({ txHash, fromAddress, amountUsdt, blockNumber, blockHash }) {
  return {
    tx_hash: txHash,
    from_address: fromAddress,
    amount: amountUsdt,
    amount_wei: ethers.parseUnits(String(amountUsdt), USDT_DECIMAL_PRECISION).toString(),
    block_number: blockNumber,
    block_hash: blockHash,
  };
}

function buildSplitPaymentObservedDeposits() {
  return [
    buildObservedDeposit({
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fromAddress: '0x1111111111111111111111111111111111111111',
      amountUsdt: '1.90',
      blockNumber: 100,
      blockHash: '0xblockhash100',
    }),
    buildObservedDeposit({
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      fromAddress: '0x1111111111111111111111111111111111111111',
      amountUsdt: '1.90',
      blockNumber: 101,
      blockHash: '0xblockhash101',
    }),
  ];
}

function buildSettlementSummary(chainId) {
  return {
    finalizedBlockNumber: 110,
    confirmationsAtIssue: 10,
    chainId,
  };
}

test('resolveActiveChainId prefers CHAIN_ID and otherwise infers testnet from the RPC URL', () => {
  process.env.CHAIN_ID = '56';
  assert.equal(resolveActiveChainId(), 56);

  process.env.CHAIN_ID = '97';
  assert.equal(resolveActiveChainId(), 97);

  delete process.env.CHAIN_ID;
  process.env.BSC_RPC_URL = 'https://bsc-testnet-rpc.publicnode.com';
  assert.equal(resolveActiveChainId(), 97);

  process.env.BSC_RPC_URL = 'https://bsc-dataseed.binance.org';
  assert.equal(resolveActiveChainId(), 56);

  if (ORIGINAL_CHAIN_ID === undefined) {
    delete process.env.CHAIN_ID;
  } else {
    process.env.CHAIN_ID = ORIGINAL_CHAIN_ID;
  }
  process.env.BSC_RPC_URL = ORIGINAL_BSC_RPC_URL;
});

test('sumObservedDepositAmountWei adds split deposits exactly', () => {
  const observedDeposits = buildSplitPaymentObservedDeposits();
  const totalAmountWei = sumObservedDepositAmountWei(observedDeposits);

  assert.equal(
    totalAmountWei,
    ethers.parseUnits('3.8', USDT_DECIMAL_PRECISION)
  );
  assert.equal(formatUsdtAmountWeiAsDecimalString(totalAmountWei), '3.8');
});

test('createPaymentReceiptRecordForConfirmedPayment writes a pending receipt inside the caller transaction', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let receiptRecord;

  try {
    await client.query('BEGIN');
    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });

    const receiptVisibleOutsideTransaction = await fetchPaymentReceiptByBookingId(
      bookingRecord.id
    );
    assert.equal(
      receiptVisibleOutsideTransaction,
      null,
      'the receipt must not be visible before the confirmation transaction commits'
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  assert.equal(receiptRecord.status, 'pending');
  assert.equal(receiptRecord.bookingId, bookingRecord.id);
  assert.equal(receiptRecord.paymentId, paymentRecord.id);
  assert.equal(receiptRecord.orderId, orderRecord.id);
  assert.equal(receiptRecord.depositAddress, depositAddress);
  assert.equal(
    receiptRecord.payerAddress,
    '0x1111111111111111111111111111111111111111'
  );
  assert.equal(
    receiptRecord.txHash,
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'the completing deposit is the last block'
  );
  assert.equal(receiptRecord.blockNumber, 101);
  assert.equal(receiptRecord.blockHash, '0xblockhash101');
  assert.equal(receiptRecord.amountPaidUsdt, '3.80');
  assert.equal(
    receiptRecord.amountWei,
    ethers.parseUnits('3.8', USDT_DECIMAL_PRECISION).toString()
  );
  assert.equal(receiptRecord.finalizedBlockNumber, 110);
  assert.equal(receiptRecord.confirmationsAtIssue, 10);
  assert.equal(
    receiptRecord.explorerTxUrl,
    'https://bscscan.com/tx/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  assert.equal(receiptRecord.pdfPath, null);
  assert.equal(receiptRecord.attemptCount, 0);

  const storedReceipt = await fetchPaymentReceiptByPaymentId(paymentRecord.id);
  assert.equal(storedReceipt.id, receiptRecord.id);
  assert.equal(storedReceipt.bookingId, bookingRecord.id);
  assert.equal(storedReceipt.status, 'pending');
});

test('createPaymentReceiptRecordForConfirmedPayment builds a testnet explorer URL for chain 97', async () => {
  process.env.CHAIN_ID = '97';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let receiptRecord;
  try {
    await client.query('BEGIN');
    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(97),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  assert.equal(
    receiptRecord.explorerTxUrl,
    'https://testnet.bscscan.com/tx/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );

  process.env.CHAIN_ID = ORIGINAL_CHAIN_ID ?? '56';
});

test('createPaymentReceiptRecordForConfirmedPayment refuses a payment that is not confirmed', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Pending Receipt Attendee',
    email: 'pending-receipt@example.com',
    phone_number: '+255712345699',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'usdt_bep20'
  );

  const client = await pool.connect();
  try {
    await assert.rejects(
      createPaymentReceiptRecordForConfirmedPayment({
        client,
        paymentRecord,
        bookingRecord,
        orderRecord: null,
        depositAddress: '0xDepositAddressForReceipt',
        observedDeposits: buildSplitPaymentObservedDeposits(),
        settlementSummary: buildSettlementSummary(56),
      }),
      /PAYMENT_RECEIPT_REQUIRES_CONFIRMED_PAYMENT/
    );
  } finally {
    client.release();
  }

  const receiptAfterRefusal = await fetchPaymentReceiptByBookingId(bookingRecord.id);
  assert.equal(receiptAfterRefusal, null);
});

test('createPaymentReceiptRecordForConfirmedPayment is idempotent when the confirmation is retried', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const firstAttemptClient = await pool.connect();
  let firstReceiptRecord;
  try {
    await firstAttemptClient.query('BEGIN');
    firstReceiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client: firstAttemptClient,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });
    await firstAttemptClient.query('COMMIT');
  } catch (error) {
    await firstAttemptClient.query('ROLLBACK');
    firstAttemptClient.release();
    throw error;
  }
  firstAttemptClient.release();

  const retryObservedDeposits = [
    ...buildSplitPaymentObservedDeposits(),
    buildObservedDeposit({
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      fromAddress: '0x2222222222222222222222222222222222222222',
      amountUsdt: '0.10',
      blockNumber: 105,
      blockHash: '0xblockhash105',
    }),
  ];

  const retryAttemptClient = await pool.connect();
  let retriedReceiptRecord;
  try {
    await retryAttemptClient.query('BEGIN');
    retriedReceiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client: retryAttemptClient,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: retryObservedDeposits,
      settlementSummary: { ...buildSettlementSummary(56), finalizedBlockNumber: 120 },
    });
    await retryAttemptClient.query('COMMIT');
  } catch (error) {
    await retryAttemptClient.query('ROLLBACK');
    retryAttemptClient.release();
    throw error;
  }
  retryAttemptClient.release();

  assert.equal(
    retriedReceiptRecord.id,
    firstReceiptRecord.id,
    'a retried confirmation must update the same receipt, not insert a new one'
  );

  const receiptRowCount = await pool.query(
    'SELECT COUNT(*)::int AS receipt_count FROM payment_receipts WHERE payment_id = $1',
    [paymentRecord.id]
  );
  assert.equal(receiptRowCount.rows[0].receipt_count, 1);

  assert.equal(
    retriedReceiptRecord.txHash,
    '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  );
  assert.equal(retriedReceiptRecord.amountPaidUsdt, '3.90');
  assert.equal(retriedReceiptRecord.finalizedBlockNumber, 120);
  assert.equal(
    retriedReceiptRecord.payerAddress,
    '0x1111111111111111111111111111111111111111',
    'the payer address stays the first observed deposit'
  );
});

test('fetchPaymentReceiptsAwaitingDelivery returns pending and failed receipts only', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let pendingReceiptRecord;
  try {
    await client.query('BEGIN');
    pendingReceiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  const receiptsBeforeFailure = await fetchPaymentReceiptsAwaitingDelivery();
  assert.equal(receiptsBeforeFailure.length, 1);
  assert.equal(receiptsBeforeFailure[0].status, 'pending');

  await markPaymentReceiptFailed(
    pendingReceiptRecord.id,
    'SMTP refused connection'
  );

  const receiptsAfterFailure = await fetchPaymentReceiptsAwaitingDelivery();
  assert.equal(receiptsAfterFailure.length, 1);
  assert.equal(receiptsAfterFailure[0].status, 'failed');
  assert.equal(receiptsAfterFailure[0].attemptCount, 1);
  assert.equal(receiptsAfterFailure[0].lastError, 'SMTP refused connection');

  const issuedReceipt = await markPaymentReceiptIssued(pendingReceiptRecord.id, {
    pdfPath: '/tmp/receipt.pdf',
    pdfSha256: 'abc123',
  });

  assert.equal(issuedReceipt.status, 'issued');
  assert.equal(issuedReceipt.attemptCount, 2);
  assert.equal(issuedReceipt.lastError, null);
  assert.equal(issuedReceipt.pdfPath, '/tmp/receipt.pdf');
  assert.equal(issuedReceipt.pdfSha256, 'abc123');
  assert.ok(issuedReceipt.issuedAt);

  const receiptsAfterIssue = await fetchPaymentReceiptsAwaitingDelivery();
  assert.equal(receiptsAfterIssue.length, 0);

  const storedReceipt = await fetchPaymentReceiptByBookingId(bookingRecord.id);
  assert.equal(storedReceipt.status, 'issued');
  assert.equal(storedReceipt.attemptCount, 2);
});

test('buildPaymentReceiptPdfForConfirmedPayment writes the PDF to disk and marks the receipt issued', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let receiptRecord;
  try {
    await client.query('BEGIN');
    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  const buildResult = await buildPaymentReceiptPdfForConfirmedPayment(
    bookingRecord.id,
    receiptRecord
  );

  assert.equal(
    path.dirname(buildResult.filePath),
    resolvePaymentReceiptsDirectory()
  );
  assert.equal(
    path.basename(buildResult.filePath),
    `blockchain-masterclass-receipt-${bookingRecord.ref}.pdf`
  );
  assert.match(buildResult.sha256, /^[a-f0-9]{64}$/);

  const writtenPdf = await fs.readFile(buildResult.filePath);
  assert.equal(writtenPdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(writtenPdf.length > 2000);

  assert.equal(buildResult.receiptRecord.status, 'issued');
  assert.equal(buildResult.receiptRecord.pdfPath, buildResult.filePath);
  assert.equal(buildResult.receiptRecord.pdfSha256, buildResult.sha256);
  assert.equal(buildResult.receiptRecord.attemptCount, 1);

  const storedReceipt = await fetchPaymentReceiptByBookingId(bookingRecord.id);
  assert.equal(storedReceipt.status, 'issued');
  assert.equal(storedReceipt.pdfSha256, buildResult.sha256);

  await fs.rm(buildResult.filePath, { force: true });
});

test('deliverPaymentReceiptEmailToAttendee attaches the receipt PDF and marks the receipt issued', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let receiptRecord;
  try {
    await client.query('BEGIN');
    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  const sentMessages = [];
  const recordingTransport = {
    async sendMail(message) {
      sentMessages.push(message);
      return { accepted: [message.to] };
    },
  };

  const deliveryResult = await deliverPaymentReceiptEmailToAttendee(bookingRecord.id, {
    receiptRecord,
    transport: recordingTransport,
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, bookingRecord.email);
  assert.ok(sentMessages[0].subject.includes(bookingRecord.ref));
  assert.ok(sentMessages[0].html.includes(receiptRecord.txHash));
  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].contentType, 'application/pdf');
  assert.equal(
    sentMessages[0].attachments[0].filename,
    `blockchain-masterclass-receipt-${bookingRecord.ref}.pdf`
  );

  const attachedFileContents = sentMessages[0].attachments[0].content;
  assert.ok(Buffer.isBuffer(attachedFileContents));
  assert.equal(attachedFileContents.subarray(0, 5).toString(), '%PDF-');

  assert.equal(deliveryResult.delivered, true);
  assert.equal(deliveryResult.receiptId, receiptRecord.id);

  const storedReceipt = await fetchPaymentReceiptByBookingId(bookingRecord.id);
  assert.equal(storedReceipt.status, 'issued');
  assert.equal(storedReceipt.attemptCount, 1);
  assert.equal(storedReceipt.lastError, null);
  assert.match(storedReceipt.pdfSha256, /^[a-f0-9]{64}$/);

  await fs.rm(deliveryResult.filePath, { force: true });
});

test('deliverPaymentReceiptEmailToAttendee records a failure and rethrows when the transport rejects', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let receiptRecord;
  try {
    await client.query('BEGIN');
    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  const failingTransport = {
    async sendMail() {
      throw new Error('SMTP refused connection');
    },
  };

  await assert.rejects(
    deliverPaymentReceiptEmailToAttendee(bookingRecord.id, {
      receiptRecord,
      transport: failingTransport,
    }),
    /PAYMENT_RECEIPT_EMAIL_DELIVERY_FAILED/
  );

  const storedReceipt = await fetchPaymentReceiptByBookingId(bookingRecord.id);
  assert.equal(storedReceipt.status, 'failed');
  assert.equal(storedReceipt.lastError, 'SMTP refused connection');
  assert.equal(storedReceipt.attemptCount, 1);
  assert.equal(storedReceipt.issuedAt, null);

  const receiptsAwaitingDelivery = await fetchPaymentReceiptsAwaitingDelivery();
  assert.equal(receiptsAwaitingDelivery.length, 1);
  assert.equal(receiptsAwaitingDelivery[0].id, receiptRecord.id);

  await fs.rm(
    path.join(
      resolvePaymentReceiptsDirectory(),
      `blockchain-masterclass-receipt-${bookingRecord.ref}.pdf`
    ),
    { force: true }
  );
});

test('buildPaymentReceiptPdfArtifactForBooking keeps the PDF in memory when local storage is disabled', async () => {
  process.env.CHAIN_ID = '56';
  const { bookingRecord, paymentRecord, orderRecord, depositAddress } =
    await createConfirmedUsdtBookingWithOrder();

  const client = await pool.connect();
  let receiptRecord;
  try {
    await client.query('BEGIN');
    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord,
      bookingRecord,
      orderRecord,
      depositAddress,
      observedDeposits: buildSplitPaymentObservedDeposits(),
      settlementSummary: buildSettlementSummary(56),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const previousDocumentStorageMode = process.env.DOCUMENT_STORAGE_MODE;
  process.env.DOCUMENT_STORAGE_MODE = 'memory';

  try {
    const receiptArtifact = await buildPaymentReceiptPdfArtifactForBooking(
      bookingRecord.id,
      receiptRecord
    );

    assert.equal(receiptArtifact.filePath, null);
    assert.ok(Buffer.isBuffer(receiptArtifact.pdfBuffer));
    assert.equal(receiptArtifact.pdfBuffer.subarray(0, 5).toString(), '%PDF-');
    assert.match(receiptArtifact.fileName, /^blockchain-masterclass-receipt-.*\.pdf$/);
    assert.match(receiptArtifact.sha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previousDocumentStorageMode === undefined) {
      delete process.env.DOCUMENT_STORAGE_MODE;
    } else {
      process.env.DOCUMENT_STORAGE_MODE = previousDocumentStorageMode;
    }
  }
});
