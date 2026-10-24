import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordById,
  PaymentNotFoundError,
  initiateAzamPesaPayment,
  findAzamPayPaymentRecordByExternalId,
} from '../services/paymentService.js';

import {
  fetchBookingRecordById,
  reactivateExpiredBookingSeatHold,
} from '../services/bookingService.js';

import { getUsdtExpectedAmount } from '../services/usdtPaymentService.js';
import {
  USDT_CLAIM_TRANSACTION_NOT_FOUND,
  USDT_CLAIM_TRANSFER_NOT_FOR_THIS_BOOKING,
  verifyClaimedUsdtTransferForBooking,
} from '../services/usdtPaymentClaimService.js';

import { fetchPaymentReceiptByBookingId } from '../services/paymentReceiptService.js';
import { fetchOfflinePaymentReceiptByPaymentId } from '../services/offlinePaymentReceiptService.js';

import {
  createOrderWithDepositAddressForBooking,
  fetchActiveOrderDepositAddressForBooking,
  reissueDepositAddressForOrder,
  OrderAlreadyExistsError,
} from '../services/orderService.js';

import {
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_LIPANAMBA,
  PAYMENT_METHOD_USDT_BEP20,
  AZAMPESA_PAYMENTS_ENABLED,
} from '../services/eventConfigService.js';

import {
  invalidPaymentMethodResponse,
  paymentMethodNotAvailableResponse,
  missingRequiredFieldResponse,
  paymentNotFoundResponse,
  azamPayInvalidMethodResponse,
  usdtInvalidMethodResponse,
  adminPaymentNotFoundResponse,
  usdtPaymentNotFoundResponse,
  azamPayHoldExpiredResponse,
} from '../utils/responseHelpers.js';

// What the client is allowed to see about the chain: enough to display "we saw
// your payment" (amount seen, whether the chain has settled it) and to link to
// the receipt, without exposing the full transaction record.
async function buildPaymentSettlementSummaryForClient(paymentRecord) {
  const [depositSummaryResult, receiptResult] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(amount_wei), 0) AS observed_wei,
              COUNT(*)::INT AS observed_count,
              MAX(block_number) AS latest_block_number,
              BOOL_OR(is_finalized) AS all_finalized
         FROM deposits_observed
         JOIN orders ON orders.id = deposits_observed.order_id
        WHERE orders.booking_id = $1`,
      [paymentRecord.booking_id]
    ),
    fetchPaymentReceiptByBookingId(paymentRecord.booking_id),
  ]);

  const depositSummary = depositSummaryResult.rows[0];
  const observedAmountWei = String(depositSummary.observed_wei);
  const hasObservedDeposit = depositSummary.observed_count > 0;

  return {
    expectedAmountUsdt: paymentRecord.amount_expected ?? getUsdtExpectedAmount(),
    observedTransferCount: depositSummary.observed_count,
    observedAmountUsdt: hasObservedDeposit
      ? Number(ethers.formatUnits(observedAmountWei, 18))
      : 0,
    isObservedPaymentSettled: hasObservedDeposit === true && depositSummary.all_finalized === true,
    latestObservedBlockNumber: depositSummary.latest_block_number
      ? Number(depositSummary.latest_block_number)
      : null,
    receipt: receiptResult
      ? {
          status: receiptResult.status,
          txHash: receiptResult.txHash,
          blockNumber: receiptResult.blockNumber,
          explorerTxUrl: receiptResult.explorerTxUrl,
          issuedAt: receiptResult.issuedAt,
        }
      : null,
  };
}

async function getPaymentRecordById(req, res) {
  const paymentId = parseInt(req.params.id, 10);

  try {
    const paymentRecord = await fetchPaymentRecordById(paymentId);
    if (!paymentRecord) {
      throw new PaymentNotFoundError(paymentId);
    }
    // Settlement evidence only exists for on-chain payments. Skipping it for
    // AzamPesa keeps the polling endpoint at one query per request.
    const settlementSummary =
      paymentRecord.payment_method === PAYMENT_METHOD_USDT_BEP20
        ? await buildPaymentSettlementSummaryForClient(paymentRecord)
        : null;

    const offlineReceipt =
      paymentRecord.payment_method === PAYMENT_METHOD_LIPANAMBA
        ? await fetchOfflinePaymentReceiptByPaymentId(paymentRecord.id)
        : null;

    return res.status(200).json({
      payment: paymentRecord,
      settlement: settlementSummary,
      offlineReceipt,
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return res.status(404).json(paymentNotFoundResponse());
    }
    console.error('Error fetching payment by id', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function createPaymentRecord(req, res) {
  const { booking_id: bookingId, payment_method: paymentMethod } = req.body;

  if (!bookingId || !paymentMethod) {
    return res
      .status(400)
      .json(missingRequiredFieldResponse('booking_id, payment_method'));
  }

  try {
    const paymentRecord = await createPendingPaymentRecordForBooking(bookingId, paymentMethod);
    return res.status(201).json({ payment: paymentRecord });
  } catch (error) {
    if (error.code === 'INVALID_PAYMENT_METHOD') {
      return res.status(400).json(invalidPaymentMethodResponse(error.paymentMethod));
    }
    if (error.code === 'PAYMENT_METHOD_NOT_AVAILABLE') {
      return res.status(409).json(paymentMethodNotAvailableResponse(error.paymentMethod));
    }
    console.error('Error creating payment', error);
    return res.status(500).json({ message: 'Error creating payment' });
  }
}

async function initiateAzamPesaPaymentEndpoint(req, res) {
  // AzamPesa is retired. The route stays mounted so an old client gets a clear
  // refusal instead of a generic 404, but it never reaches the provider.
  if (!AZAMPESA_PAYMENTS_ENABLED) {
    return res
      .status(409)
      .json(paymentMethodNotAvailableResponse(PAYMENT_METHOD_AZAMPESA));
  }

  const paymentId = parseInt(req.params.id, 10);
  const { phone_number: stkPhoneNumber } = req.body;

  if (stkPhoneNumber && !/^\+?[0-9]{9,15}$/.test(String(stkPhoneNumber))) {
    return res.status(400).json(missingRequiredFieldResponse('phone number'));
  }

  try {
    const paymentRecord = await fetchPaymentRecordById(paymentId);
    if (!paymentRecord) {
      throw new PaymentNotFoundError(paymentId);
    }

    const bookingRecord = await fetchBookingRecordById(paymentRecord.booking_id);
    if (!bookingRecord) {
      throw new PaymentNotFoundError(paymentId);
    }

    const initiationResult = await initiateAzamPesaPayment(
      paymentRecord.booking_id,
      bookingRecord,
      stkPhoneNumber
    );

    return res.status(200).json({
      message: 'Payment prompt sent, waiting for customer approval',
      externalId: initiationResult.externalId,
      status: initiationResult.status,
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return res.status(404).json(paymentNotFoundResponse());
    }
    if (error.message === 'AZAMPESA_HOLD_EXPIRED') {
      return res.status(409).json(azamPayHoldExpiredResponse());
    }
    if (error.message === 'AZAMPESA_INVALID_METHOD') {
      return res.status(400).json(azamPayInvalidMethodResponse());
    }
    if (error.message === 'AZAMPESA_PAYMENT_NOT_FOUND') {
      return res.status(404).json(adminPaymentNotFoundResponse());
    }
    console.error('Error initiating AzamPesa payment', error);
    return res.status(502).json({ message: 'Failed to initiate AzamPesa payment' });
  }
}

async function fetchPaymentStatusByExternalId(req, res) {
  const externalId = req.params.externalId;

  try {
    const paymentRecord = await findAzamPayPaymentRecordByExternalId(externalId);
    if (!paymentRecord) {
      return res.status(404).json(paymentNotFoundResponse());
    }

    return res.status(200).json({
      externalId,
      currentStatus: paymentRecord.status,
      bookingId: paymentRecord.booking_id,
    });
  } catch (error) {
    console.error('Error fetching payment status by external id', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Hands the client a deposit address that is actually being watched.
//
// A booking whose hold lapsed used to keep returning the same expired address,
// which nobody scanned any more: the client paid and the payment was invisible.
// There are three cases, and only the first two may be handed an address:
//   * the order is still live      -> return the address it already has
//   * the order expired unpaid     -> issue a fresh address and renew the hold
//   * the order already received   -> refuse, the payment is being processed
async function resolveDepositAddressForUsdtInitiation(paymentRecord) {
  let orderDeposit = await fetchActiveOrderDepositAddressForBooking(paymentRecord.booking_id);

  if (!orderDeposit) {
    const createdOrder = await createOrderWithDepositAddressForBooking(paymentRecord.booking_id);
    return {
      order: createdOrder,
      depositAddress: createdOrder.deposit_address,
      renewed: false,
    };
  }

  const isOrderHoldExpired =
    orderDeposit.order.status === 'expired' || new Date(orderDeposit.order.expires_at) <= new Date();

  if (!isOrderHoldExpired) {
    return { ...orderDeposit, renewed: false };
  }

  const observedDepositResult = await pool.query(
    'SELECT count(*)::INT AS observed_count FROM deposits_observed WHERE order_id = $1',
    [orderDeposit.order.id]
  );
  if (observedDepositResult.rows[0].observed_count > 0) {
    const alreadyFundedError = new Error('USDT_PAYMENT_ALREADY_RECEIVED');
    alreadyFundedError.code = 'USDT_PAYMENT_ALREADY_RECEIVED';
    throw alreadyFundedError;
  }

  const renewedOrder = await reissueDepositAddressForOrder(orderDeposit.order.id);
  await reactivateExpiredBookingSeatHold(paymentRecord.booking_id).catch(() => {});

  return {
    order: renewedOrder,
    depositAddress: renewedOrder.deposit_address,
    renewed: true,
  };
}

async function initiateUsdtPaymentEndpoint(req, res) {
  const paymentId = parseInt(req.params.id, 10);

  try {
    const paymentRecord = await fetchPaymentRecordById(paymentId);
    if (!paymentRecord) {
      throw new PaymentNotFoundError(paymentId);
    }
    if (paymentRecord.payment_method !== PAYMENT_METHOD_USDT_BEP20) {
      return res
        .status(400)
        .json(usdtInvalidMethodResponse());
    }
    if (paymentRecord.status === 'confirmed') {
      return res.status(200).json({
        message: 'This payment is already confirmed',
        alreadyConfirmed: true,
        bookingId: paymentRecord.booking_id,
        paymentId: paymentRecord.id,
      });
    }

    const bookingRecord = await fetchBookingRecordById(paymentRecord.booking_id);
    if (!bookingRecord) {
      throw new PaymentNotFoundError(paymentId);
    }
    if (bookingRecord.status === 'cancelled') {
      return res.status(409).json({ message: 'This booking was cancelled' });
    }

    const orderDeposit = await resolveDepositAddressForUsdtInitiation(paymentRecord);

    return res.status(200).json({
      message: 'Transfer USDT to your unique deposit address',
      receivingWallet: orderDeposit.depositAddress,
      expectedAmountUsdt: paymentRecord.amount_expected ?? getUsdtExpectedAmount(),
      bookingId: paymentRecord.booking_id,
      orderId: orderDeposit.order.id,
      holdRenewed: orderDeposit.renewed === true,
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return res.status(404).json(paymentNotFoundResponse());
    }
    if (error instanceof OrderAlreadyExistsError) {
      return res.status(409).json({ message: error.message });
    }
    if (error.code === 'USDT_PAYMENT_ALREADY_RECEIVED') {
      return res.status(409).json({
        message: 'A payment was already received for this booking and is being confirmed',
        paymentReceived: true,
      });
    }
    console.error('Error initiating USDT payment', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

function buildUsdtClaimPendingMessage(pendingReason) {
  switch (pendingReason) {
    case USDT_CLAIM_TRANSACTION_NOT_FOUND:
      return 'This transaction is not on the chain yet. Try again once it is mined.';
    case USDT_CLAIM_TRANSFER_NOT_FOR_THIS_BOOKING:
      return 'This transaction did not send USDT to the deposit address for this booking.';
    default:
      return 'Transfer not yet confirmed';
  }
}

// Serverless deployments cannot run the five-second listener, so USDT
// observation is driven by the scheduled cron tick and the payment monitor job.
async function verifyUsdtPaymentEndpoint(req, res) {
  const paymentId = parseInt(req.params.id, 10);
  const { tx_hash: txHash } = req.body;

  if (!txHash) {
    return res
      .status(400)
      .json(missingRequiredFieldResponse('tx_hash'));
  }

  try {
    const paymentRecord = await fetchPaymentRecordById(paymentId);
    if (!paymentRecord) {
      throw new PaymentNotFoundError(paymentId);
    }

    const confirmationResult = await verifyClaimedUsdtTransferForBooking(
      paymentRecord.booking_id,
      txHash
    );

    if (!confirmationResult.confirmed) {
      return res.status(200).json({
        confirmed: false,
        reason: confirmationResult.reason,
        message: buildUsdtClaimPendingMessage(confirmationResult.reason),
      });
    }

    return res.status(200).json({ confirmed: true, message: 'Payment confirmed' });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return res.status(404).json(paymentNotFoundResponse());
    }
    if (error.message === 'USDT_PAYMENT_NOT_FOUND') {
      return res
        .status(404)
        .json(usdtPaymentNotFoundResponse());
    }
    if (error.message === 'USDT_INVALID_METHOD') {
      return res
        .status(400)
        .json(usdtInvalidMethodResponse());
    }
    console.error('Error verifying USDT payment', error);
    return res.status(502).json({ message: 'Failed to verify USDT payment on the blockchain' });
  }
}

export default {
  getPaymentRecordById,
  createPaymentRecord,
  initiateAzamPesaPaymentEndpoint,
  fetchPaymentStatusByExternalId,
  initiateUsdtPaymentEndpoint,
  verifyUsdtPaymentEndpoint,
};