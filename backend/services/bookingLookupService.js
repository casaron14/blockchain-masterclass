import pool from '../config/db.js';

import {
  fetchBookingRecordByReferenceCode,
  fetchBookingRecordsByAttendeeNameFragment,
  fetchBookingRecordsByEmailAddress,
  fetchBookingRecordsByPhoneNumber,
  fetchEventAvailabilitySnapshot,
} from './bookingService.js';

import {
  BOOKING_SEARCH_IDENTIFIER_KINDS,
  resolveBookingSearchIdentifier,
} from './bookingSearchIdentifierService.js';

import { fetchActiveOrderDepositAddressForBooking } from './orderService.js';
import { fetchPaymentReceiptByBookingId } from './paymentReceiptService.js';

import { PAYMENT_METHOD_USDT_BEP20 } from './eventConfigService.js';

export class AmbiguousBookingLookupError extends Error {
  constructor(matchingBookingCount) {
    super(
      'More than one booking matches that search. Use the booking reference to identify one booking.'
    );
    this.name = 'AmbiguousBookingLookupError';
    this.code = 'AMBIGUOUS_BOOKING_LOOKUP';
    this.matchingBookingCount = matchingBookingCount;
  }
}

async function buildBookingLookupDetailsForBookingRecord(bookingRecord) {
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

export async function fetchBookingWithPaymentDetailsByReferenceCode(bookingReferenceCode) {
  const bookingRecord = await fetchBookingRecordByReferenceCode(bookingReferenceCode);
  if (!bookingRecord) {
    return null;
  }
  return buildBookingLookupDetailsForBookingRecord(bookingRecord);
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

async function fetchCandidateBookingRecordsForSearchIdentifier(
  resolvedSearchIdentifier,
  { allowAttendeeNameSearch }
) {
  switch (resolvedSearchIdentifier.kind) {
    case BOOKING_SEARCH_IDENTIFIER_KINDS.REFERENCE_CODE: {
      const bookingRecord = await fetchBookingRecordByReferenceCode(
        resolvedSearchIdentifier.normalizedValue
      );
      // A six-letter attendee name such as "JOHN" also looks like a reference
      // code. Only the admin surface may fall back to the name search here;
      // the public lookup treats it as an unmatched reference.
      if (bookingRecord) {
        return [bookingRecord];
      }
      if (!allowAttendeeNameSearch) {
        return [];
      }
      return fetchBookingRecordsByAttendeeNameFragment(resolvedSearchIdentifier.normalizedValue);
    }
    case BOOKING_SEARCH_IDENTIFIER_KINDS.EMAIL_ADDRESS:
      return fetchBookingRecordsByEmailAddress(resolvedSearchIdentifier.normalizedValue);
    case BOOKING_SEARCH_IDENTIFIER_KINDS.PHONE_NUMBER:
      return fetchBookingRecordsByPhoneNumber(resolvedSearchIdentifier.normalizedValue);
    case BOOKING_SEARCH_IDENTIFIER_KINDS.ATTENDEE_NAME:
      return fetchBookingRecordsByAttendeeNameFragment(resolvedSearchIdentifier.normalizedValue);
    default:
      throw new Error(`Unsupported booking search identifier: ${resolvedSearchIdentifier.kind}`);
  }
}

export async function performBookingLookupBySearchValue(
  rawSearchValue,
  { allowAttendeeNameSearch = false } = {}
) {
  const resolvedSearchIdentifier = resolveBookingSearchIdentifier(rawSearchValue, {
    allowAttendeeNameSearch,
  });
  const candidateBookingRecords = await fetchCandidateBookingRecordsForSearchIdentifier(
    resolvedSearchIdentifier,
    { allowAttendeeNameSearch }
  );

  if (candidateBookingRecords.length === 0) {
    return null;
  }

  // Returning the newest row would silently reveal one attendee's booking when
  // a shared email, phone number, or partial name matches several records.
  if (candidateBookingRecords.length > 1) {
    throw new AmbiguousBookingLookupError(candidateBookingRecords.length);
  }

  const lookupDetails = await buildBookingLookupDetailsForBookingRecord(
    candidateBookingRecords[0]
  );
  const actions = await buildBookingLookupActions(lookupDetails);
  return { ...lookupDetails, actions };
}