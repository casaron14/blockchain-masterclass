import { ethers } from 'ethers';
import pool from '../config/db.js';

import { resolveBscRpcUrl } from './rpcEndpointResolver.js';

import { fetchPaymentRecordById } from './paymentService.js';

import { confirmBookingSeatWithinClientCapacity } from './bookingService.js';

import { deliverTicketForConfirmedBooking } from './ticketDeliveryService.js';
import {
  createPaymentReceiptRecordForConfirmedPayment,
  deliverPaymentReceiptEmailToAttendee,
} from './paymentReceiptService.js';

import { TICKET_PRICE_USDT, PAYMENT_METHOD_USDT_BEP20 } from './eventConfigService.js';

import {
  evaluateOrderPaymentSettlement,
  fetchObservedDepositRecordsForOrderId,
  getExpectedPaymentAmountWei,
  markObservedDepositsAsFinalized,
} from './usdtSettlementService.js';

import { verifyPaymentAgainstSweepEvidence } from './sweepVerificationService.js';

export const USDT_BEP20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export const DEFAULT_USDT_DECIMALS = 18;

export function createUsdtProvider() {
  return new ethers.JsonRpcProvider(resolveBscRpcUrl());
}

export function getUsdtReceivingWalletAddress() {
  return process.env.USDT_RECEIVING_WALLET;
}

export function getUsdtContractAddress() {
  return process.env.USDT_CONTRACT_ADDRESS;
}

export function getUsdtExpectedAmount() {
  return TICKET_PRICE_USDT;
}

export function getTreasuryWalletAddress() {
  return process.env.TREASURY_WALLET_ADDRESS || getUsdtReceivingWalletAddress();
}

// A single transaction can carry several USDT Transfer logs: a batch payout, a
// router, or a contract distributing to more than one address. A claim has to
// see all of them before it decides which deposit address was paid, so this
// returns the whole list instead of the first match.
export function parseAllUsdtTransfersFromReceipt(transactionReceipt, usdtContractAddress) {
  const usdtInterface = new ethers.Interface(USDT_BEP20_ABI);
  const parsedTransfers = [];

  for (const log of transactionReceipt.logs) {
    if (String(log.address).toLowerCase() !== String(usdtContractAddress).toLowerCase()) {
      continue;
    }
    try {
      const parsedLog = usdtInterface.parseLog({ topics: log.topics, data: log.data });
      if (parsedLog && parsedLog.name === 'Transfer') {
        parsedTransfers.push({
          fromAddress: parsedLog.args[0],
          toAddress: parsedLog.args[1],
          value: parsedLog.args[2],
          logIndex: Number(log.index ?? log.logIndex ?? 0),
        });
      }
    } catch (error) {
      continue;
    }
  }

  return parsedTransfers;
}

export async function recordBlockchainTransaction(client, paymentId, transactionDetails) {
  const result = await client.query(
    `INSERT INTO blockchain_transactions
       (payment_id, tx_hash, block_number, from_address, to_address, value)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash) DO NOTHING
     RETURNING *`,
    [
      paymentId,
      transactionDetails.txHash,
      transactionDetails.blockNumber,
      transactionDetails.fromAddress,
      transactionDetails.toAddress,
      transactionDetails.amountUsdt,
    ]
  );
  return result.rows[0] ?? null;
}

export async function recordBlockchainTransactionError(paymentId, txHash, errorMessage, client = pool) {
  const result = await client.query(
    `INSERT INTO blockchain_transaction_errors (payment_id, tx_hash, error_message)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [paymentId, txHash, errorMessage]
  );
  return result.rows[0] ?? null;
}

// Money that arrived but cannot be completed automatically is parked here with
// the facts attached, so a human (or a later automated refund) can act on it
// without re-deriving what happened from the chain.
export async function recordPaymentReviewFlag(
  { orderId, bookingId, paymentId, depositAddress, txHash, amount, reason, details, autoAction },
  client = pool
) {
  const result = await client.query(
    `INSERT INTO payment_review_flags
       (order_id, booking_id, payment_id, deposit_address, tx_hash, amount, reason, details, auto_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      orderId ?? null,
      bookingId ?? null,
      paymentId ?? null,
      depositAddress ?? null,
      txHash ?? null,
      amount ?? null,
      reason,
      details ? JSON.stringify(details) : null,
      autoAction ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

async function fetchPaymentRecordForUpdate(client, paymentId) {
  const result = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
  return result.rows[0] ?? null;
}

async function fetchBookingRecordForUpdate(client, bookingId) {
  const result = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
  return result.rows[0] ?? null;
}

export async function fetchUsdtPaymentRecordById(paymentId) {
  return fetchPaymentRecordById(paymentId);
}

// The one place a USDT payment becomes a confirmed booking.
//
// Everything the attendee and the business need to trust the payment is written
// in a single database transaction, in this order: the observed transfers, the
// blockchain transaction, the payment status, the seat, the order status and the
// receipt row. Either all of it exists or none of it does, so a crash can never
// leave a confirmed payment without a seat or a receipt without a payment.
//
// The ticket and receipt emails are sent AFTER the commit, so a mail failure can
// never roll back a payment, and a failed send is retried by a job.
export async function confirmUsdtOrderPaymentFromObservedDeposits({
  orderId,
  bookingId,
  paymentId,
  depositAddress,
  settlementFrontier,
  observedDeposits,
  chainId,
  client: providedClient,
  deliverTicket = deliverTicketForConfirmedBooking,
  deliverReceiptEmail = deliverPaymentReceiptEmailToAttendee,
}) {
  const client = providedClient ?? (await pool.connect());
  const ownsTransaction = !providedClient;

  let confirmationOutcome = null;
  let receiptRecord = null;

  try {
    if (ownsTransaction) {
      await client.query('BEGIN');
    }

    const paymentRecord = await fetchPaymentRecordForUpdate(client, paymentId);
    if (!paymentRecord) {
      throw new Error('USDT_PAYMENT_NOT_FOUND');
    }
    if (paymentRecord.payment_method !== PAYMENT_METHOD_USDT_BEP20) {
      throw new Error('USDT_INVALID_METHOD');
    }
    if (paymentRecord.status === 'confirmed') {
      if (ownsTransaction) {
        await client.query('ROLLBACK');
      }
      return { confirmed: true, alreadyConfirmed: true, reason: 'ALREADY_CONFIRMED' };
    }

    const bookingRecord = await fetchBookingRecordForUpdate(client, bookingId);
    if (!bookingRecord) {
      throw new Error('USDT_BOOKING_NOT_FOUND');
    }

    const settlementDecision = evaluateOrderPaymentSettlement({
      paymentRecord,
      observedDeposits,
      settlementFrontier,
    });
    if (!settlementDecision.ready) {
      if (ownsTransaction) {
        await client.query('ROLLBACK');
      }
      return { confirmed: false, reason: settlementDecision.reason, settlementDecision };
    }

    const completingDeposit = settlementDecision.completingDeposit;
    const orderRecord = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);

    const seatConfirmation = await confirmBookingSeatWithinClientCapacity(client, bookingId);

    // The money is real even when the seat cannot be granted, so the payment is
    // still recorded and confirmed; the booking is closed and the difference is
    // handed to a human as a refund case instead of being lost.
    if (!seatConfirmation.seatConfirmed) {
      await client.query(
        `UPDATE payments
            SET status = 'confirmed', tx_hash = $2, confirmed_at = now()
          WHERE id = $1`,
        [paymentId, completingDeposit.tx_hash]
      );
      await markObservedDepositsAsFinalized(
        observedDeposits.map((observedDeposit) => observedDeposit.id),
        settlementFrontier.finalizedBlockNumber,
        client
      );
      await recordBlockchainTransaction(client, paymentId, {
        txHash: completingDeposit.tx_hash,
        blockNumber: completingDeposit.block_number,
        fromAddress: completingDeposit.from_address,
        toAddress: completingDeposit.address,
        amountUsdt: Number(completingDeposit.amount),
      });
      await recordPaymentReviewFlag(
        {
          orderId,
          bookingId,
          paymentId,
          depositAddress,
          txHash: completingDeposit.tx_hash,
          amount: Number(completingDeposit.amount),
          reason: 'hold_expired_no_seat',
          details: { seatConfirmationReason: seatConfirmation.reason },
          autoAction: 'payment_confirmed_without_seat',
        },
        client
      );

      if (ownsTransaction) {
        await client.query('COMMIT');
      }

      return {
        confirmed: true,
        seatConfirmed: false,
        reason: seatConfirmation.reason,
        requiresRefund: true,
        settlementDecision,
      };
    }

    await client.query(
      `UPDATE payments
          SET status = 'confirmed', tx_hash = $2, confirmed_at = now()
        WHERE id = $1`,
      [paymentId, completingDeposit.tx_hash]
    );

    await markObservedDepositsAsFinalized(
      observedDeposits.map((observedDeposit) => observedDeposit.id),
      settlementFrontier.finalizedBlockNumber,
      client
    );

    await recordBlockchainTransaction(client, paymentId, {
      txHash: completingDeposit.tx_hash,
      blockNumber: completingDeposit.block_number,
      fromAddress: completingDeposit.from_address,
      toAddress: completingDeposit.address,
      amountUsdt: Number(completingDeposit.amount),
    });

    await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);

    receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord: { ...paymentRecord, status: 'confirmed' },
      bookingRecord: seatConfirmation.bookingRecord,
      orderRecord: orderRecord.rows[0] ?? null,
      depositAddress,
      observedDeposits,
      settlementSummary: {
        finalizedBlockNumber: settlementFrontier.finalizedBlockNumber,
        confirmationsAtIssue: settlementDecision.confirmations,
        chainId,
      },
    });

    if (ownsTransaction) {
      await client.query('COMMIT');
    }

    confirmationOutcome = {
      confirmed: true,
      seatConfirmed: true,
      reason: 'OK',
      txHash: completingDeposit.tx_hash,
      blockNumber: completingDeposit.block_number,
      amountPaidUsdt: settlementDecision.totalAmountUsdt,
      settlementDecision,
    };
  } catch (error) {
    if (ownsTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    if (ownsTransaction) {
      client.release();
    }
  }

  // Post-commit side effects. Failures here are recorded by the delivery layer
  // and retried by jobs/ticketDeliveryRetryJob.js; they never undo the payment.
  const deliveryOutcome = await deliverTicketAndReceiptAfterConfirmation({
    bookingId,
    receiptRecord,
    confirmationOutcome,
    deliverTicket,
    deliverReceiptEmail,
  });

  return { ...confirmationOutcome, deliveryOutcome };
}

// Post-commit side effects. The delivery layer attaches the receipt PDF to the
// ticket email and sends the receipt itself, records any failure, and the retry
// job picks it up later. A mail problem can never undo a confirmed payment.
async function deliverTicketAndReceiptAfterConfirmation({
  bookingId,
  receiptRecord,
  confirmationOutcome,
  deliverTicket,
  deliverReceiptEmail,
}) {
  const deliveryOutcome = { ticketDelivered: false, receiptDelivered: false };

  const ticketDeliveryResult = await deliverTicket(bookingId, undefined, {
    receiptRecord,
    deliverReceiptEmail,
    paymentSummary: {
      txHash: confirmationOutcome.txHash,
      amountPaidUsdt: confirmationOutcome.amountPaidUsdt,
      blockNumber: confirmationOutcome.blockNumber,
    },
  });

  deliveryOutcome.ticketDelivered = ticketDeliveryResult?.delivered === true;
  deliveryOutcome.receiptDelivered = ticketDeliveryResult?.receipt?.delivered === true;
  deliveryOutcome.ticketDeliveryResult = ticketDeliveryResult;

  return deliveryOutcome;
}

export async function verifyUsdtCumulativeDepositBalanceOnChain(depositAddress, provider = createUsdtProvider()) {
  const usdtContractAddress = getUsdtContractAddress();
  if (!usdtContractAddress) {
    return { valid: false, reason: 'USDT_CONTRACT_ADDRESS_MISSING' };
  }
  const usdtContract = new ethers.Contract(
    usdtContractAddress,
    ['function balanceOf(address account) view returns (uint256)'],
    provider
  );

  const depositBalanceWei = await usdtContract.balanceOf(depositAddress);
  const expectedAmountWei = ethers.parseUnits(String(getUsdtExpectedAmount()), DEFAULT_USDT_DECIMALS);

  if (depositBalanceWei < expectedAmountWei) {
    return { valid: false, reason: 'AMOUNT_UNDERPAID' };
  }
  return { valid: true, reason: 'OK', balanceWei: depositBalanceWei };
}

// Evidence-first verification: the recorded transfers and the sweep records
// decide, and the live token balance is only a supporting signal. This is what
// keeps a payment verifiable after a daily sweep has moved the funds onward.
export async function verifyUsdtPaymentFromRecordedEvidence({
  orderId,
  depositAddress,
  paymentRecord,
}) {
  const observedDeposits = await fetchObservedDepositRecordsForOrderId(orderId);
  const observedTotalWei = observedDeposits.reduce(
    (runningTotal, observedDeposit) => runningTotal + BigInt(observedDeposit.amount_wei),
    0n
  );
  const expectedAmountWei = getExpectedPaymentAmountWei(paymentRecord);

  if (observedTotalWei >= expectedAmountWei) {
    return { valid: true, reason: 'OBSERVED_DEPOSITS', observedTotalWei, expectedAmountWei };
  }

  const sweepEvidence = await verifyPaymentAgainstSweepEvidence({
    orderId,
    depositAddress,
    expectedAmountWei,
  });

  if (sweepEvidence.paid) {
    return {
      valid: true,
      reason: 'SWEEP_EVIDENCE',
      observedTotalWei,
      expectedAmountWei,
      sweepEvidence,
    };
  }

  return { valid: false, reason: 'NO_SETTLED_EVIDENCE', observedTotalWei, expectedAmountWei };
}
