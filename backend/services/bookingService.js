import pool from '../config/db.js';
import crypto from 'node:crypto';

import {
  OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES,
  PRIMARY_EVENT_SLUG,
  SEAT_HOLD_DURATION_MINUTES,
} from './eventConfigService.js';

import {
  EventNotFoundError,
  buildEventSnapshotFromEventRecord,
  ensureEventSeatCapacityRowExistsForEventRecord,
  fetchEventRecordByIdFromDatabase,
  fetchEventRecordBySlugFromDatabase,
} from './eventRegistryService.js';

export const BOOKING_HOLD_DURATION_MINUTES = SEAT_HOLD_DURATION_MINUTES;

// Kept for older operational scripts. Application code now scopes every
// capacity read to an explicit event id.
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

// Callers may pass a slug (public API), an event id (booking already in the
// database), or a complete event record (already resolved by a controller).
export async function resolveEventRecordForBookingScope(eventReference) {
  if (eventReference && typeof eventReference === 'object' && eventReference.id) {
    return eventReference;
  }

  if (typeof eventReference === 'number') {
    const eventRecord = await fetchEventRecordByIdFromDatabase(eventReference);
    if (eventRecord) {
      return eventRecord;
    }
    throw new EventNotFoundError(eventReference);
  }

  if (typeof eventReference === 'string' && eventReference.trim() !== '') {
    const trimmedEventReference = eventReference.trim();
    // pg returns BIGINT columns as strings, so a stored event_id arrives here
    // as "1" while a public event slug never contains only digits.
    if (/^\d+$/.test(trimmedEventReference)) {
      return resolveEventRecordForBookingScope(Number(trimmedEventReference));
    }

    const eventRecord = await fetchEventRecordBySlugFromDatabase(trimmedEventReference);
    if (eventRecord) {
      return eventRecord;
    }
    throw new EventNotFoundError(eventReference);
  }

  const primaryEventRecord = await fetchEventRecordBySlugFromDatabase(PRIMARY_EVENT_SLUG);
  if (primaryEventRecord) {
    return primaryEventRecord;
  }

  throw new EventNotFoundError(PRIMARY_EVENT_SLUG);
}

async function fetchActiveSeatHoldCountForEvent(
  databaseClient,
  eventId,
  excludedBookingId = null
) {
  const result = await databaseClient.query(
    `SELECT COUNT(*)::INT AS active_holds
       FROM bookings
      WHERE event_id = $1
        AND status = 'pending'
        AND expires_at > now()
        AND ($2::bigint IS NULL OR id <> $2::bigint)`,
    [eventId, excludedBookingId]
  );
  return result.rows[0].active_holds;
}

export async function fetchEventAvailabilitySnapshot(eventReference = PRIMARY_EVENT_SLUG) {
  const eventRecord = await resolveEventRecordForBookingScope(eventReference);
  await ensureEventSeatCapacityRowExistsForEventRecord(pool, eventRecord);

  // One round trip instead of two: the event's capacity row and its live hold
  // count are read together, so the availability banner stays a single query.
  const availabilityResult = await pool.query(
    `SELECT capacity.confirmed_count,
            capacity.cap,
            (SELECT COUNT(*)::INT
               FROM bookings AS booking_record
              WHERE booking_record.event_id = $1
                AND booking_record.status = 'pending'
                AND booking_record.expires_at > now()) AS active_seat_holds
       FROM event_seat_capacity AS capacity
      WHERE capacity.event_id = $1`,
    [eventRecord.id]
  );
  const capacityRow = availabilityResult.rows[0];
  if (!capacityRow) {
    throw new Error(`Seat capacity row is missing for event ${eventRecord.slug}`);
  }

  const confirmedCount = Number(capacityRow.confirmed_count);
  const { cap } = capacityRow;
  const activeSeatHolds = Number(capacityRow.active_seat_holds);
  const seatsHeld = confirmedCount + activeSeatHolds;
  const seatsRemaining = Math.max(cap - seatsHeld, 0);
  const isSoldOut = seatsRemaining <= 0;

  return {
    eventSlug: eventRecord.slug,
    eventName: eventRecord.name,
    eventLifecycleStatus: eventRecord.status,
    eventStatus: isSoldOut ? 'sold_out' : 'open',
    confirmedCount,
    activeSeatHolds,
    seatsRemaining,
    seatCapacity: Number(cap),
    isSoldOut,
  };
}

export async function checkSeatAvailabilityBeforeBooking(
  eventReference = PRIMARY_EVENT_SLUG
) {
  const snapshot = await fetchEventAvailabilitySnapshot(eventReference);
  if (snapshot.isSoldOut) {
    throw new SoldOutError(snapshot.seatsRemaining);
  }
  return snapshot;
}

export async function createBookingRecordWithActiveSeatHold(
  attendeeDetails,
  eventReference = PRIMARY_EVENT_SLUG
) {
  const eventRecord = await resolveEventRecordForBookingScope(eventReference);
  const eventSnapshot = buildEventSnapshotFromEventRecord(eventRecord);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await ensureEventSeatCapacityRowExistsForEventRecord(client, eventRecord);

    const capacityLock = await client.query(
      `SELECT confirmed_count, cap
         FROM event_seat_capacity
        WHERE event_id = $1
        FOR UPDATE`,
      [eventRecord.id]
    );
    if (!capacityLock.rows[0]) {
      throw new Error(`Seat capacity row is missing for event ${eventRecord.slug}`);
    }
    const { confirmed_count: confirmedCount, cap } = capacityLock.rows[0];

    // Count the competing holds on the transaction's own connection. Counting
    // through the pool would read a different snapshot while this transaction
    // holds the event's capacity lock.
    const activeHolds = await fetchActiveSeatHoldCountForEvent(client, eventRecord.id);
    const seatsHeld = confirmedCount + activeHolds;
    const seatsRemaining = Math.max(cap - seatsHeld, 0);
    const isSoldOut = seatsRemaining <= 0;

    if (isSoldOut) {
      throw new SoldOutError(seatsRemaining);
    }

    const bookingReferenceCode = generateBookingReferenceCode();
    const utmSourceValue = attendeeDetails.utm_source?.trim() || null;

    const result = await client.query(
      `INSERT INTO bookings (
         ref,
         event_id,
         event_snapshot,
         full_name,
         phone_number,
         email,
         utm_source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        bookingReferenceCode,
        eventRecord.id,
        JSON.stringify(eventSnapshot),
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

export async function expireAllExpiredSeatHolds(eventReference = null) {
  if (!eventReference) {
    const result = await pool.query(
      `UPDATE bookings
          SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= now()
        RETURNING id`
    );
    return result.rows.length;
  }

  const eventRecord = await resolveEventRecordForBookingScope(eventReference);
  const result = await pool.query(
    `UPDATE bookings
        SET status = 'expired'
      WHERE event_id = $1
        AND status = 'pending'
        AND expires_at <= now()
      RETURNING id`,
    [eventRecord.id]
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
  const bookingResult = await client.query(
    'SELECT id, event_id FROM bookings WHERE id = $1',
    [bookingId]
  );
  const bookingRecord = bookingResult.rows[0];
  if (!bookingRecord) {
    return { seatConfirmed: false, reason: 'BOOKING_NOT_CONFIRMABLE' };
  }

  const eventRecord = await resolveEventRecordForBookingScope(bookingRecord.event_id);
  await ensureEventSeatCapacityRowExistsForEventRecord(client, eventRecord);

  const capacityLock = await client.query(
    `SELECT confirmed_count, cap
       FROM event_seat_capacity
      WHERE event_id = $1
      FOR UPDATE`,
    [eventRecord.id]
  );
  const capacityRow = capacityLock.rows[0];
  if (!capacityRow) {
    throw new Error(`Seat capacity row is missing for event ${eventRecord.slug}`);
  }

  const { confirmed_count: confirmedCount, cap } = capacityRow;
  const otherActiveHolds = await fetchActiveSeatHoldCountForEvent(
    client,
    eventRecord.id,
    bookingId
  );
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

  const eventRecord = await resolveEventRecordForBookingScope(bookingRecord.event_id);
  await checkSeatAvailabilityBeforeBooking(eventRecord);

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
