import Joi from 'joi';

import pool from '../config/db.js';

import {
  fetchBookingRecordById,
  updateBookingStatus,
  confirmBookingSeatWithinCapacity,
  generateBookingReferenceCode,
  checkSeatAvailabilityBeforeBooking,
  BookingNotFoundError,
} from './bookingService.js';

import {
  fetchPaymentRecordByBookingId,
  updatePaymentRecordStatus,
} from './paymentService.js';

import { deliverTicketForConfirmedBooking } from './ticketDeliveryService.js';

import {
  approveOfflinePaymentReceiptForConfirmedPayment,
  fetchOfflinePaymentReceiptByBookingId,
} from './offlinePaymentReceiptService.js';

import { PAYMENT_METHOD_LIPANAMBA } from './eventConfigService.js';

import { fetchOrderByBookingId, fetchDepositAddressByOrderId } from './orderService.js';

export const ADMIN_BOOKING_STATUS_VALUES = Object.freeze([
  'pending',
  'confirmed',
  'cancelled',
  'expired',
]);

export class InvalidAdminBookingStatusError extends Error {
  constructor(invalidStatus) {
    super(`Invalid booking status: ${invalidStatus}`);
    this.name = 'InvalidAdminBookingStatusError';
    this.code = 'INVALID_BOOKING_STATUS';
  }
}

export const adminBookingCreationSchema = Joi.object({
  full_name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().required(),
  phone_number: Joi.string()
    .trim()
    .pattern(/^\+?[0-9]{9,15}$/)
    .required(),
  utm_source: Joi.string()
    .trim()
    .allow('')
    .max(100)
    .optional(),
});

export const adminBookingUpdateSchema = Joi.object({
  full_name: Joi.string().trim().min(2).max(120).optional(),
  email: Joi.string().trim().email().optional(),
  phone_number: Joi.string()
    .trim()
    .pattern(/^\+?[0-9]{9,15}$/)
    .optional(),
  utm_source: Joi.string().trim().allow('').max(100).optional(),
  status: Joi.string().valid(...ADMIN_BOOKING_STATUS_VALUES).optional(),
}).min(1);

function validateAdminBookingStatus(newBookingStatus) {
  if (!ADMIN_BOOKING_STATUS_VALUES.includes(newBookingStatus)) {
    throw new InvalidAdminBookingStatusError(newBookingStatus);
  }
  return newBookingStatus;
}

async function fetchPaymentRecordForBookingRow(bookingRow) {
  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRow.id);
  let orderAndDeposit = null;
  if (paymentRecord) {
    const orderRecord = await fetchOrderByBookingId(bookingRow.id);
    if (orderRecord) {
      const depositAddressRecord = await fetchDepositAddressByOrderId(orderRecord.id);
      orderAndDeposit = {
        order: orderRecord,
        depositAddress: depositAddressRecord?.address ?? null,
      };
    }
  }
  return { payment: paymentRecord, orderAndDeposit };
}

export async function fetchAdminBookingList({ statusFilter } = {}) {
  const whereClause = statusFilter ? 'WHERE b.status = $1' : '';
  const queryParams = statusFilter ? [statusFilter] : [];

  const result = await pool.query(
    `SELECT b.*, p.status AS payment_status, p.payment_method, p.amount_expected,
            p.confirmed_at AS payment_confirmed_at,
            opr.status AS offline_receipt_status,
            r.referrer_name, r.referrer_phone
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id
       LEFT JOIN offline_payment_receipts opr ON opr.payment_id = p.id
       LEFT JOIN referrers r ON r.referrer_code = b.utm_source
       ${whereClause}
       ORDER BY b.created_at DESC`,
    queryParams
  );

  return result.rows;
}

export async function fetchBookingStatusCounts() {
  const result = await pool.query(
    'SELECT status, COUNT(*)::int AS count FROM bookings GROUP BY status'
  );

  const statusCounts = { pending: 0, confirmed: 0, cancelled: 0, expired: 0 };
  for (const statusRow of result.rows) {
    if (statusRow.status in statusCounts) {
      statusCounts[statusRow.status] = statusRow.count;
    }
  }
  return statusCounts;
}

export async function fetchAdminBookingDetail(bookingId) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    throw new BookingNotFoundError(bookingId);
  }

  const { payment, orderAndDeposit } = await fetchPaymentRecordForBookingRow(bookingRecord);
  const offlineReceipt =
    payment?.payment_method === PAYMENT_METHOD_LIPANAMBA
      ? await fetchOfflinePaymentReceiptByBookingId(bookingRecord.id)
      : null;

  return {
    booking: bookingRecord,
    payment,
    order: orderAndDeposit?.order ?? null,
    depositAddress: orderAndDeposit?.depositAddress ?? null,
    offlineReceipt,
  };
}

export async function createAdminBookingRecord(
  attendeeDetails,
  { autoConfirm = false } = {}
) {
  const bookingReferenceCode = generateBookingReferenceCode();
  const utmSourceValue = attendeeDetails.utm_source?.trim() || null;

  if (autoConfirm) {
    await checkSeatAvailabilityBeforeBooking();
  }

  const insertResult = await pool.query(
    `INSERT INTO bookings (ref, full_name, phone_number, email, utm_source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      bookingReferenceCode,
      attendeeDetails.full_name,
      attendeeDetails.phone_number,
      attendeeDetails.email,
      utmSourceValue,
    ]
  );

  let createdBooking = insertResult.rows[0];

  if (autoConfirm) {
    createdBooking = await confirmBookingSeatWithinCapacity(createdBooking.id);
  }

  return createdBooking;
}

export async function updateAdminBookingRecord(bookingId, updateFields) {
  const { status: requestedStatus, ...attendeeFields } = updateFields;

  if (attendeeFields.utm_source === '' || attendeeFields.utm_source === null) {
    attendeeFields.utm_source = null;
  }

  const hasAttendeeFields = Object.keys(attendeeFields).length > 0;
  if (hasAttendeeFields) {
    const setClause = Object.keys(attendeeFields)
      .map((fieldName, fieldIndex) => `${fieldName} = $${fieldIndex + 1}`)
      .join(', ');
    const fieldValues = Object.values(attendeeFields);
    fieldValues.push(bookingId);

    await pool.query(
      `UPDATE bookings SET ${setClause}, updated_at = now() WHERE id = $${fieldValues.length}
       RETURNING *`,
      fieldValues
    );
  }

  let updatedBooking = await fetchBookingRecordById(bookingId);
  if (!updatedBooking) {
    throw new BookingNotFoundError(bookingId);
  }

  if (requestedStatus && requestedStatus !== updatedBooking.status) {
    validateAdminBookingStatus(requestedStatus);

    if (requestedStatus === 'confirmed') {
      updatedBooking = await confirmBookingSeatWithinCapacity(bookingId);
    } else {
      updatedBooking = await updateBookingStatus(bookingId, requestedStatus);
    }
  }

  return updatedBooking;
}

export class BookingNotConfirmableError extends Error {
  constructor(bookingId) {
    super(`Booking ${bookingId} is cancelled and can no longer be confirmed`);
    this.name = 'BookingNotConfirmableError';
    this.code = 'BOOKING_NOT_CONFIRMABLE';
  }
}

// The single final step an admin takes on a booking: the seat is confirmed, the
// payment is marked as received, the uploaded Lipa Namba receipt is approved and
// the ticket is emailed. Doing it in one action is what removes the old split
// between "confirm payment" and "confirm booking".
export async function confirmAdminBookingRecord(
  bookingId,
  deliverTicket = deliverTicketForConfirmedBooking
) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    throw new BookingNotFoundError(bookingId);
  }

  if (bookingRecord.status === 'cancelled') {
    throw new BookingNotConfirmableError(bookingId);
  }

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingId);
  const bookingAlreadyConfirmed = bookingRecord.status === 'confirmed';
  const paymentAlreadyConfirmed = !paymentRecord || paymentRecord.status === 'confirmed';

  if (bookingAlreadyConfirmed && paymentAlreadyConfirmed) {
    return {
      booking: bookingRecord,
      payment: paymentRecord,
      ticketDelivery: null,
      alreadyConfirmed: true,
    };
  }

  if (!bookingAlreadyConfirmed) {
    try {
      await confirmBookingSeatWithinCapacity(bookingId);
    } catch (error) {
      // Two admins can confirm the same booking at once. The second request
      // finds the seat already confirmed, which is not a failure: continue
      // with the payment and ticket instead of reporting the booking missing.
      const refreshedBookingRecord = await fetchBookingRecordById(bookingId);
      if (!refreshedBookingRecord || refreshedBookingRecord.status !== 'confirmed') {
        throw error;
      }
    }
  }

  if (paymentRecord) {
    await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');
    await approveOfflinePaymentReceiptForConfirmedPayment(paymentRecord.id);
  }

  const ticketDelivery = await deliverTicket(bookingId);

  return {
    booking: await fetchBookingRecordById(bookingId),
    payment: await fetchPaymentRecordByBookingId(bookingId),
    ticketDelivery,
    alreadyConfirmed: false,
  };
}