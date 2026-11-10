import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

import { ethers } from 'ethers';
import pool from '../config/db.js';

import { fetchBookingRecordById } from './bookingService.js';

import {
  resolveOutboundEmailSenderIdentity,
  sendOutboundEmailThroughConfiguredProvider,
} from './emailTransportService.js';
import {
  EMAIL_DELIVERY_KIND_RECEIPT,
  buildBookingEmailDeliveryMetadata,
} from './bookingEmailDeliveryMetadataService.js';
import { fetchPaymentRecordById } from './paymentService.js';

import { buildExplorerTransactionUrl } from './blockExplorerService.js';

import { generatePaymentReceiptPdfBuffer } from './paymentReceiptPdfService.js';
import { isLocalDocumentStorageEnabled } from '../config/documentStorage.js';

import {
  EVENT_TITLE,
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  PRIMARY_EVENT_SLUG,
} from './eventConfigService.js';

import {
  buildPaymentReceiptEmailHtml,
  buildPaymentReceiptEmailSubject,
} from './paymentReceiptEmailComposer.js';

export {
  buildPaymentReceiptEmailHtml,
  buildPaymentReceiptEmailSubject,
};

const USDT_DECIMAL_PRECISION = 18;
const BSC_MAINNET_CHAIN_ID = 56;
const BSC_TESTNET_CHAIN_ID = 97;

const PAYMENT_RECEIPT_STATUS_AWAITING_DELIVERY = ['pending', 'failed'];

const RECEIPTS_DIRECTORY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../out/receipts'
);

// The chain the backend is pointed at decides both the chain id recorded on the
// receipt and the explorer the attendee is sent to. An explicit CHAIN_ID wins;
// otherwise the RPC endpoint tells us which network we are actually on.
export function resolveActiveChainId() {
  if (process.env.CHAIN_ID) {
    return Number(process.env.CHAIN_ID);
  }

  const configuredRpcUrl = process.env.BSC_RPC_URL || '';
  if (configuredRpcUrl.includes('testnet')) {
    return BSC_TESTNET_CHAIN_ID;
  }

  return BSC_MAINNET_CHAIN_ID;
}

export function resolveEventDetailsForReceipt() {
  return {
    eventTitle: EVENT_TITLE,
    eventDate: EVENT_DATE_LABEL,
    eventLocation: EVENT_LOCATION,
  };
}

export function resolvePaymentReceiptsDirectory() {
  return RECEIPTS_DIRECTORY_PATH;
}

function readObservedDepositField(observedDeposit, camelCaseField, snakeCaseField) {
  if (!observedDeposit) {
    return null;
  }
  return observedDeposit[camelCaseField] ?? observedDeposit[snakeCaseField] ?? null;
}

function resolveObservedDepositAmountWei(observedDeposit) {
  const exactWeiValue = readObservedDepositField(observedDeposit, 'amountWei', 'amount_wei');
  if (exactWeiValue !== null && exactWeiValue !== undefined) {
    return BigInt(String(exactWeiValue));
  }

  const roundedUsdtValue = readObservedDepositField(observedDeposit, 'amount', 'amount_usdt');
  if (roundedUsdtValue === null || roundedUsdtValue === undefined) {
    throw new Error('Observed deposit is missing both amount_wei and amount');
  }

  return ethers.parseUnits(String(roundedUsdtValue), USDT_DECIMAL_PRECISION);
}

export function sumObservedDepositAmountWei(observedDeposits) {
  return observedDeposits.reduce(
    (runningTotal, observedDeposit) => runningTotal + resolveObservedDepositAmountWei(observedDeposit),
    0n
  );
}

export function formatUsdtAmountWeiAsDecimalString(totalAmountWei) {
  return ethers.formatUnits(totalAmountWei, USDT_DECIMAL_PRECISION);
}

function selectCompletingObservedDeposit(observedDeposits) {
  const depositsByBlockHeight = [...observedDeposits].sort(
    (firstDeposit, secondDeposit) =>
      Number(readObservedDepositField(firstDeposit, 'blockNumber', 'block_number')) -
      Number(readObservedDepositField(secondDeposit, 'blockNumber', 'block_number'))
  );

  return depositsByBlockHeight[depositsByBlockHeight.length - 1];
}

function selectFirstObservedDepositPayerAddress(observedDeposits) {
  const firstObservedDeposit = observedDeposits[0];
  return readObservedDepositField(firstObservedDeposit, 'fromAddress', 'from_address');
}

function validatePaymentIsConfirmedBeforeReceiptCreation(paymentRecord) {
  if (!paymentRecord) {
    throw new Error('PAYMENT_RECEIPT_PAYMENT_RECORD_MISSING');
  }

  if (paymentRecord.status !== 'confirmed') {
    throw new Error(
      `PAYMENT_RECEIPT_REQUIRES_CONFIRMED_PAYMENT:${paymentRecord.status}`
    );
  }
}

function validateObservedDepositsBeforeReceiptCreation(observedDeposits) {
  if (!Array.isArray(observedDeposits) || observedDeposits.length === 0) {
    throw new Error('PAYMENT_RECEIPT_REQUIRES_OBSERVED_DEPOSIT');
  }
}

function normalizePaymentReceiptRow(receiptRow) {
  if (!receiptRow) {
    return null;
  }

  return {
    id: Number(receiptRow.id),
    paymentId: Number(receiptRow.payment_id),
    bookingId: Number(receiptRow.booking_id),
    orderId: receiptRow.order_id == null ? null : Number(receiptRow.order_id),
    depositAddress: receiptRow.deposit_address,
    payerAddress: receiptRow.payer_address,
    txHash: receiptRow.tx_hash,
    blockNumber: Number(receiptRow.block_number),
    blockHash: receiptRow.block_hash,
    amountPaidUsdt: String(receiptRow.amount_paid),
    amountWei: String(receiptRow.amount_wei),
    finalizedBlockNumber: Number(receiptRow.finalized_block_number),
    confirmationsAtIssue: Number(receiptRow.confirmations_at_issue),
    explorerTxUrl: receiptRow.explorer_tx_url,
    pdfPath: receiptRow.pdf_path,
    pdfSha256: receiptRow.pdf_sha256,
    status: receiptRow.status,
    attemptCount: Number(receiptRow.attempt_count),
    lastError: receiptRow.last_error,
    issuedAt: receiptRow.issued_at,
    createdAt: receiptRow.created_at,
    updatedAt: receiptRow.updated_at,
  };
}

// Written by the confirmation transaction that flips the payment to confirmed,
// on the same client, so the receipt row can never exist for a payment that was
// not confirmed. It commits nothing: the caller owns BEGIN/COMMIT.
export async function createPaymentReceiptRecordForConfirmedPayment({
  client,
  paymentRecord,
  bookingRecord,
  orderRecord,
  depositAddress,
  observedDeposits,
  settlementSummary,
}) {
  validatePaymentIsConfirmedBeforeReceiptCreation(paymentRecord);
  validateObservedDepositsBeforeReceiptCreation(observedDeposits);

  if (!depositAddress) {
    throw new Error('PAYMENT_RECEIPT_REQUIRES_DEPOSIT_ADDRESS');
  }

  if (!bookingRecord?.id) {
    throw new Error('PAYMENT_RECEIPT_REQUIRES_BOOKING_RECORD');
  }

  const completingObservedDeposit = selectCompletingObservedDeposit(observedDeposits);
  const payerAddress = selectFirstObservedDepositPayerAddress(observedDeposits);

  const totalAmountWei = sumObservedDepositAmountWei(observedDeposits);
  const amountPaidUsdt = formatUsdtAmountWeiAsDecimalString(totalAmountWei);

  const chainId = Number(settlementSummary?.chainId ?? resolveActiveChainId());
  const completingTxHash = readObservedDepositField(
    completingObservedDeposit,
    'txHash',
    'tx_hash'
  );

  if (!completingTxHash) {
    throw new Error('PAYMENT_RECEIPT_REQUIRES_COMPLETING_TRANSACTION_HASH');
  }

  const insertResult = await client.query(
    `INSERT INTO payment_receipts
       (payment_id, booking_id, order_id, deposit_address, payer_address,
        tx_hash, block_number, block_hash, amount_paid, amount_wei,
        finalized_block_number, confirmations_at_issue, explorer_tx_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
     ON CONFLICT (payment_id) DO UPDATE
       SET booking_id = EXCLUDED.booking_id,
           order_id = EXCLUDED.order_id,
           deposit_address = EXCLUDED.deposit_address,
           payer_address = EXCLUDED.payer_address,
           tx_hash = EXCLUDED.tx_hash,
           block_number = EXCLUDED.block_number,
           block_hash = EXCLUDED.block_hash,
           amount_paid = EXCLUDED.amount_paid,
           amount_wei = EXCLUDED.amount_wei,
           finalized_block_number = EXCLUDED.finalized_block_number,
           confirmations_at_issue = EXCLUDED.confirmations_at_issue,
           explorer_tx_url = EXCLUDED.explorer_tx_url
     RETURNING *`,
    [
      paymentRecord.id,
      bookingRecord.id,
      orderRecord?.id ?? null,
      depositAddress,
      payerAddress,
      completingTxHash,
      readObservedDepositField(completingObservedDeposit, 'blockNumber', 'block_number'),
      readObservedDepositField(completingObservedDeposit, 'blockHash', 'block_hash'),
      amountPaidUsdt,
      totalAmountWei.toString(),
      Number(settlementSummary?.finalizedBlockNumber ?? 0),
      Number(settlementSummary?.confirmationsAtIssue ?? 0),
      buildExplorerTransactionUrl(completingTxHash, chainId),
    ]
  );

  return normalizePaymentReceiptRow(insertResult.rows[0]);
}

export async function fetchPaymentReceiptByBookingId(bookingId) {
  const fetchResult = await pool.query(
    'SELECT * FROM payment_receipts WHERE booking_id = $1',
    [bookingId]
  );
  return normalizePaymentReceiptRow(fetchResult.rows[0]);
}

export async function fetchPaymentReceiptByPaymentId(paymentId) {
  const fetchResult = await pool.query(
    'SELECT * FROM payment_receipts WHERE payment_id = $1',
    [paymentId]
  );
  return normalizePaymentReceiptRow(fetchResult.rows[0]);
}

export async function fetchPaymentReceiptsAwaitingDelivery() {
  const fetchResult = await pool.query(
    `SELECT * FROM payment_receipts
      WHERE status = ANY($1::receipt_status[])
      ORDER BY created_at ASC`,
    [PAYMENT_RECEIPT_STATUS_AWAITING_DELIVERY]
  );
  return fetchResult.rows.map(normalizePaymentReceiptRow);
}

export async function markPaymentReceiptIssued(receiptId, { pdfPath, pdfSha256 }) {
  const updateResult = await pool.query(
    `UPDATE payment_receipts
        SET status = 'issued',
            pdf_path = $1,
            pdf_sha256 = $2,
            issued_at = now(),
            last_error = NULL,
            attempt_count = attempt_count + 1
      WHERE id = $3
      RETURNING *`,
    [pdfPath, pdfSha256, receiptId]
  );

  return normalizePaymentReceiptRow(updateResult.rows[0]);
}

export async function markPaymentReceiptFailed(receiptId, errorMessage) {
  const updateResult = await pool.query(
    `UPDATE payment_receipts
        SET status = 'failed',
            last_error = $1,
            attempt_count = attempt_count + 1
      WHERE id = $2
      RETURNING *`,
    [errorMessage, receiptId]
  );

  return normalizePaymentReceiptRow(updateResult.rows[0]);
}

export function buildPaymentReceiptQrPayload(bookingRecord, receiptRecord) {
  return {
    documentType: 'payment-receipt',
    bookingReference: bookingRecord.ref,
    attendeeName: bookingRecord.full_name,
    bookingId: bookingRecord.id,
    receiptId: receiptRecord.id,
    paymentTransactionHash: receiptRecord.txHash,
    amountPaidUsdt: receiptRecord.amountPaidUsdt,
    amountPaidWei: receiptRecord.amountWei,
    explorerTransactionUrl: receiptRecord.explorerTxUrl,
    eventTitle: EVENT_TITLE,
  };
}

function buildReceiptFileNameForBooking(bookingRecord) {
  const safeEventSlug = String(PRIMARY_EVENT_SLUG).replace(/[^a-zA-Z0-9-_]/g, '');
  const safeBookingReference = String(bookingRecord.ref).replace(/[^a-zA-Z0-9-_]/g, '');

  return `${safeEventSlug}-receipt-${safeBookingReference}.pdf`;
}

// Renders the receipt into a buffer and, on a host with a writable disk, also
// stores it. The buffer is always returned so email delivery and serverless
// deployments never depend on the file existing.
export async function buildPaymentReceiptPdfArtifactForBooking(bookingId, receiptRecord) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    throw new Error(`PAYMENT_RECEIPT_BOOKING_NOT_FOUND:${bookingId}`);
  }

  const paymentRecord = await fetchPaymentRecordById(receiptRecord.paymentId);
  if (!paymentRecord) {
    throw new Error(`PAYMENT_RECEIPT_PAYMENT_NOT_FOUND:${receiptRecord.paymentId}`);
  }

  const receiptPdfBuffer = await generatePaymentReceiptPdfBuffer({
    bookingRecord,
    paymentRecord,
    receiptRecord,
    eventDetails: resolveEventDetailsForReceipt(),
    qrPayloadPayload: buildPaymentReceiptQrPayload(bookingRecord, receiptRecord),
  });

  const receiptFileName = buildReceiptFileNameForBooking(bookingRecord);
  const pdfSha256 = crypto.createHash('sha256').update(receiptPdfBuffer).digest('hex');

  let receiptFilePath = null;
  if (isLocalDocumentStorageEnabled()) {
    await fs.mkdir(RECEIPTS_DIRECTORY_PATH, { recursive: true });
    receiptFilePath = path.join(RECEIPTS_DIRECTORY_PATH, receiptFileName);
    await fs.writeFile(receiptFilePath, receiptPdfBuffer);
  }

  return {
    filePath: receiptFilePath,
    fileName: receiptFileName,
    pdfBuffer: receiptPdfBuffer,
    sha256: pdfSha256,
  };
}

export async function buildPaymentReceiptPdfForConfirmedPayment(bookingId, receiptRecord) {
  const receiptArtifact = await buildPaymentReceiptPdfArtifactForBooking(
    bookingId,
    receiptRecord
  );
  const issuedReceipt = await markPaymentReceiptIssued(receiptRecord.id, {
    pdfPath: receiptArtifact.filePath,
    pdfSha256: receiptArtifact.sha256,
  });

  return {
    filePath: receiptArtifact.filePath,
    fileName: receiptArtifact.fileName,
    pdfBuffer: receiptArtifact.pdfBuffer,
    sha256: receiptArtifact.sha256,
    receiptRecord: issuedReceipt,
  };
}

export function resolveReceiptSenderAddress() {
  return resolveOutboundEmailSenderIdentity().address;
}

export async function deliverPaymentReceiptEmailToAttendee(bookingId, options = {}) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    throw new Error(`PAYMENT_RECEIPT_BOOKING_NOT_FOUND:${bookingId}`);
  }

  const receiptRecord = options.receiptRecord ?? (await fetchPaymentReceiptByBookingId(bookingId));
  if (!receiptRecord) {
    throw new Error(`PAYMENT_RECEIPT_NOT_FOUND_FOR_BOOKING:${bookingId}`);
  }

  const receiptArtifact = options.pdfBuffer
    ? {
        filePath: options.filePath ?? null,
        fileName: options.fileName ?? buildReceiptFileNameForBooking(bookingRecord),
        pdfBuffer: options.pdfBuffer,
        sha256:
          options.pdfSha256 ??
          crypto.createHash('sha256').update(options.pdfBuffer).digest('hex'),
      }
    : await buildPaymentReceiptPdfArtifactForBooking(bookingId, receiptRecord);

  const outboundEmailMessage = {
    from: resolveOutboundEmailSenderIdentity(),
    to: bookingRecord.email,
    subject: buildPaymentReceiptEmailSubject(bookingRecord),
    html: buildPaymentReceiptEmailHtml(bookingRecord, receiptRecord),
    attachments: [
      {
        filename: receiptArtifact.fileName,
        content: receiptArtifact.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    if (options.transport) {
      await options.transport.sendMail(outboundEmailMessage);
    } else {
      await sendOutboundEmailThroughConfiguredProvider(outboundEmailMessage, {
        deliveryMetadata: buildBookingEmailDeliveryMetadata(
          bookingRecord,
          EMAIL_DELIVERY_KIND_RECEIPT
        ),
      });
    }
  } catch (emailError) {
    const failureReason = emailError?.message || 'Unknown receipt email delivery error';
    await markPaymentReceiptFailed(receiptRecord.id, failureReason);
    throw new Error(`PAYMENT_RECEIPT_EMAIL_DELIVERY_FAILED:${bookingId}:${failureReason}`);
  }

  const issuedReceipt = await markPaymentReceiptIssued(receiptRecord.id, {
    pdfPath: receiptArtifact.filePath,
    pdfSha256: receiptArtifact.sha256,
  });

  return {
    delivered: true,
    bookingId: bookingRecord.id,
    receiptId: issuedReceipt.id,
    filePath: receiptArtifact.filePath,
    sha256: receiptArtifact.sha256,
    receiptRecord: issuedReceipt,
  };
}
