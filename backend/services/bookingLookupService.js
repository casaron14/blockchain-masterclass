import pool from '../config/db.js';

import {
  fetchBookingRecordByReferenceCode,
  fetchEventAvailabilitySnapshot,
} from './bookingService.js';

import { fetchActiveOrderDepositAddressForBooking } from './orderService.js';
import { fetchPaymentReceiptByBookingId } from './paymentReceiptService.js';

import { PAYMENT_METHOD_USDT_BEP20 } from './eventConfigService.js';

export async function fetchBookingWithPaymentDetailsByReferenceCode(bookingReferenceCode) {
  const bookingRecord = await fetchBookingRecordByReferenceCode(bookingReferenceCode);
  if (!bookingRecord) {
    return null;
  }

  const paymentResult = await pool.query(
    'SELECT * FROM payments WHERE booking_id = $1',
    [bookingRecord.id]
  );
  const paymentRecord = paymentResult.rows[0] ?? null;

  let usdtDepositAddress = null;
  let usdtHoldExpired = false;
  let usdtOrderStatus = null;
  if (paymentRecord?.payment_method === PAYMENT_METHOD_USDT_BEP20) {
    const activeOrderDeposit = await fetchActiveOrderDepositAddressForBooking(bookingRecord.id);
    usdtDepositAddress = activeOrderDeposit?.depositAddress ?? null;
    usdtOrderStatus = activeOrderDeposit?.order?.status ?? null;
    usdtHoldExpired =
      usdtOrderStatus === 'expired' ||
      (activeOrderDeposit?.order?.expires_at
        ? new Date(activeOrderDeposit.order.expires_at) <= new Date()
        : false);
  }

  const receiptRecord = await fetchPaymentReceiptByBookingId(bookingRecord.id);

  return {
    booking: bookingRecord,
    payment: paymentRecord,
    usdtDepositAddress,
    // Tells the client the address it is holding has lapsed, so it asks for a
    // fresh one instead of sending money to an address nobody is watching.
    usdtHoldExpired,
    usdtOrderStatus,
    receipt: receiptRecord
      ? {
          status: receiptRecord.status,
          txHash: receiptRecord.txHash,
          blockNumber: receiptRecord.blockNumber,
          amountPaidUsdt: receiptRecord.amountPaidUsdt,
          explorerTxUrl: receiptRecord.explorerTxUrl,
        }
      : null,
  };
}

export async function buildBookingLookupActions(lookupDetails) {
  const { booking: bookingRecord, payment: paymentRecord } = lookupDetails;

  const bookingStatus = bookingRecord.status;
  const paymentStatus = paymentRecord?.status ?? null;

  const canDownloadTicket = bookingStatus === 'confirmed';

  const isPaymentSettled = paymentStatus === 'confirmed';
  const isPaymentStillInProgress = ['initiating', 'pending'].includes(paymentStatus);
  const isPaymentFailed = ['failed', 'expired'].includes(paymentStatus);
  const isPaymentMissing = !paymentRecord;

  const canPayNow =
    !canDownloadTicket &&
    !isPaymentSettled &&
    (isPaymentMissing || isPaymentStillInProgress || isPaymentFailed);

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();

  return {
    canDownloadTicket,
    canPayNow: canPayNow && !availabilitySnapshot.isSoldOut,
    canDownloadReceipt: bookingStatus === 'confirmed',
    isSoldOut: availabilitySnapshot.isSoldOut,
    paymentStatus,
    bookingStatus,
    usdtHoldExpired: lookupDetails.usdtHoldExpired === true,
    receiptStatus: lookupDetails.receipt?.status ?? null,
  };
}

export async function performBookingReferenceLookup(bookingReferenceCode) {
  const lookupDetails = await fetchBookingWithPaymentDetailsByReferenceCode(bookingReferenceCode);
  if (!lookupDetails) {
    return null;
  }
  const actions = await buildBookingLookupActions(lookupDetails);
  return { ...lookupDetails, actions };
}