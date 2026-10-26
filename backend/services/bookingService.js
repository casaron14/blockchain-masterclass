import pool from '../config/db.js';
import crypto from 'node:crypto';

import { SEAT_HOLD_DURATION_MINUTES, OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES } from './eventConfigService.js';

export const BOOKING_HOLD_DURATION_MINUTES = SEAT_HOLD_DURATION_MINUTES;
export const SEAT_CAPACITY_ROW_ID = 1;

export class SoldOutError extends Error {
  constructor(seatsRemaining) {
    super('Event is sold out');
    this.name = 'SoldOutError';
    this.code = 'SOLD_OUT';
    this.seatsRemaining = seatsRemaining;
  }
}

export class BookingNotFoundError extends Error {
  constructor(bookingId) {
    super(`Booking not found for id ${bookingId}`);
    this.name = 'BookingNotFoundError';
    this.code = 'BOOKING_NOT_FOUND';
  }
}

export function generateBookingReferenceCode(length = 6) {
  const referenceAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  return Array.from(
    randomBytes,
    (byte) => referenceAlphabet[byte % referenceAlphabet.length]
  ).join('');
}

async function fetchActiveSeatHoldCount(client = pool, excludedBookingId = null) {
  const result = await client.query(
    `SELECT COUNT(*)::INT AS active_holds
       FROM bookings
      WHERE status = 'pending' AND expires_at > now()
        AND ($1::bigint IS NULL OR id <> $1::bigint)`,
    [excludedBookingId]
  );
  return result.rows[0].active_holds;
}

export async function fetchEventAvailabilitySnapshot() {
  // One round trip instead of two: the capacity row and the live hold count are
  // read together, so the availability banner stays a single query per request.
  const availabilityResult = await pool.query(
    `SELECT sc.confirmed_count,
            sc.cap,
            (SELECT COUNT(*)::INT
               FROM bookings b
              WHERE b.status = 'pending' AND b.expires_at > now()) AS active_seat_holds
       FROM seat_capacity sc
      WHERE sc.id = $1`,
    [SEAT_CAPACITY_ROW_ID]
  );
  const capacityRow = availabilityResult.rows[0];
  if (!capacityRow) {
    throw new Error('Seat capacity row is missing');
  }

  const confirmedCount = Number(capacityRow.confirmed_count);
  const { cap } = capacityRow;
  const activeSeatHolds = capacityRow.active_seat_holds;
  const seatsHeld = confirmedCount + activeSeatHolds;
  const seatsRemaining = Math.max(cap - seatsHeld, 0);
  const isSoldOut = seatsRemaining <= 0;

  return {
    eventStatus: isSoldOut ? 'sold_out' : 'open',
    confirmedCount,
    activeSeatHolds,
    seatsRemaining,
    isSoldOut,
  };
}

export async function checkSeatAvailabilityBeforeBooking() {
  const snapshot = await fetchEventAvailabilitySnapshot();
  if (snapshot.isSoldOut) {
    throw new SoldOutError(snapshot.seatsRemaining);
  }
  return snapshot;
}

export async function createBookingRecordWithActiveSeatHold(attendeeDetails) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const capacityLock = await client.query(
      'SELECT confirmed_count, cap FROM seat_capacity WHERE id = $1 FOR UPDATE',
      [SEAT_CAPACITY_ROW_ID]
    );
    if (!capacityLock.rows[0]) {
      throw new Error('Seat capacity row is missing');
    }
    const { confirmed_count: confirmedCount, cap } = capacityLock.rows[0];

    // Count the competing holds on the transaction's own connection. Counting
    // through the pool would read a different snapshot while this transaction
    // holds the capacity lock.
    const activeHolds = await fetchActiveSeatHoldCount(client);
    const seatsHeld = confirmedCount + activeHolds;
    const seatsRemaining = Math.max(cap - seatsHeld, 0);
    const isSoldOut = seatsRemaining <= 0;

    if (isSoldOut) {
      throw new SoldOutError(seatsRemaining);
    }

    const bookingReferenceCode = generateBookingReferenceCode();
    const utmSourceValue = attendeeDetails.utm_source?.trim() || null;

    const result = await client.query(
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

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function fetchBookingRecordById(bookingId) {
  const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  return result.rows[0] ?? null;
}

export async function fetchBookingRecordByReferenceCode(bookingReferenceCode) {
  const result = await pool.query('SELECT * FROM bookings WHERE ref = $1', [bookingReferenceCode]);
  return result.rows[0] ?? null;
}

// Attendees can book more than once with the same contact details, so the
// contact searches return every candidate and let the caller decide whether a
// single booking can be resolved safely.
export async function fetchBookingRecordsByEmailAddress(attendeeEmailAddress) {
  const result = await pool.query(
    `SELECT * FROM bookings
      WHERE lower(email) = lower($1)
      ORDER BY created_at DESC
      LIMIT 20`,
    [attendeeEmailAddress]
  );
  return result.rows;
}

export async function fetchBookingRecordsByPhoneNumber(attendeePhoneNumberDigits) {
  const result = await pool.query(
    `SELECT * FROM bookings
      WHERE right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 9) = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [attendeePhoneNumberDigits]
  );
  return result.rows;
}

export async function fetchBookingRecordsByAttendeeNameFragment(attendeeNameFragment) {
  const escapedNameFragment = attendeeNameFragment.replace(/[\\%_]/g, '\\$&');
  const result = await pool.query(
    `SELECT * FROM bookings
      WHERE full_name ILIKE '%' || $1 || '%' ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT 20`,
    [escapedNameFragment]
  );
  return result.rows;
}

export async function updateBookingStatus(bookingId, newBookingStatus) {
  const result = await pool.query(
    'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
    [newBookingStatus, bookingId]
  );
  return result.rows[0] ?? null;
}

export async function markBookingAsExpired(bookingId) {
  return updateBookingStatus(bookingId, 'expired');
}

export async function expireAllExpiredSeatHolds() {
  const result = await pool.query(
    `UPDATE bookings
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()
      RETURNING id`
  );
  return result.rows.length;
}

// Seat confirmation that runs inside a caller-owned transaction, so a payment
// confirmation can record the money, the seat and the receipt atomically.
//
// The hold being confirmed is excluded from the hold count: it is about to
// become a confirmed seat, so counting it as a competing hold would make the
// last available seat impossible to confirm. A booking that already lapsed
// (status 'expired') is still confirmable, which is what makes a payment that
// arrives after the hold expired worth honouring. A cancelled booking is never
// silently revived.
export async function confirmBookingSeatWithinClientCapacity(client, bookingId) {
  const capacityLock = await client.query(
    'SELECT confirmed_count, cap FROM seat_capacity WHERE id = $1 FOR UPDATE',
    [SEAT_CAPACITY_ROW_ID]
  );
  const { confirmed_count: confirmedCount, cap } = capacityLock.rows[0];

  const otherActiveHolds = await fetchActiveSeatHoldCount(client, bookingId);
  const seatsRemaining = cap - (confirmedCount + otherActiveHolds);
  if (seatsRemaining <= 0) {
    return { seatConfirmed: false, reason: 'NO_SEAT_AVAILABLE', seatsRemaining };
  }

  const confirmedBookingResult = await client.query(
    `UPDATE bookings
        SET status = 'confirmed', updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'expired')
      RETURNING *`,
    [bookingId]
  );

  if (confirmedBookingResult.rows.length === 0) {
    return { seatConfirmed: false, reason: 'BOOKING_NOT_CONFIRMABLE' };
  }

  return { seatConfirmed: true, bookingRecord: confirmedBookingResult.rows[0] };
}

export function cancelBookingSeatWithinClient(client, bookingId) {
  return client.query(
    "UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *",
    [bookingId]
  );
}

export async function confirmBookingSeatWithinCapacity(bookingId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const confirmationOutcome = await confirmBookingSeatWithinClientCapacity(client, bookingId);

    if (!confirmationOutcome.seatConfirmed) {
      if (confirmationOutcome.reason === 'BOOKING_NOT_CONFIRMABLE') {
        await client.query('ROLLBACK');
        throw new BookingNotFoundError(bookingId);
      }
      await cancelBookingSeatWithinClient(client, bookingId);
      await client.query('COMMIT');
      throw new SoldOutError(confirmationOutcome.seatsRemaining);
    }

    await client.query('COMMIT');
    return confirmationOutcome.bookingRecord;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function reactivateExpiredBookingSeatHold(bookingId) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    throw new BookingNotFoundError(bookingId);
  }
  if (bookingRecord.status !== 'expired') {
    throw new BookingNotExpiredError(bookingId);
  }

  await checkSeatAvailabilityBeforeBooking();

  const result = await pool.query(
    `UPDATE bookings
        SET status = 'pending',
            expires_at = now() + make_interval(mins => $2),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [bookingId, BOOKING_HOLD_DURATION_MINUTES]
  );

  return result.rows[0] ?? null;
}

// A Lipa Namba payer has already sent money by the time a receipt exists, so
// the seat must stay reserved while an admin reviews the proof. The normal
// 15-minute hold is too short for that manual step.
export async function extendBookingSeatHoldForOfflinePaymentReview(bookingId) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    throw new BookingNotFoundError(bookingId);
  }

  if (bookingRecord.status === 'confirmed') {
    return true;
  }
  if (bookingRecord.status === 'cancelled') {
    return false;
  }

  if (bookingRecord.status === 'expired') {
    try {
      await reactivateExpiredBookingSeatHold(bookingId);
    } catch (error) {
      if (error instanceof SoldOutError) {
        return false;
      }
      if (!(error instanceof BookingNotExpiredError)) {
        throw error;
      }
    }
  }

  const extensionResult = await pool.query(
    `UPDATE bookings
        SET expires_at = now() + make_interval(mins => $2),
            updated_at = now()
      WHERE id = $1
        AND status = 'pending'
      RETURNING id`,
    [bookingId, OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES]
  );

  return extensionResult.rowCount > 0;
}

export class BookingNotExpiredError extends Error {
  constructor(bookingId) {
    super(`Booking ${bookingId} is not in the expired state and cannot be reactivated`);
    this.name = 'BookingNotExpiredError';
    this.code = 'BOOKING_NOT_EXPIRED';
  }
}
