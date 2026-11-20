import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  checkSeatAvailabilityBeforeBooking,
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
  expireAllExpiredSeatHolds,
  extendBookingSeatHoldForOfflinePaymentReview,
  fetchEventAvailabilitySnapshot,
  updateBookingStatus,
  SoldOutError,
} from '../services/bookingService.js';

import {
  OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES,
  SEAT_CAPACITY,
} from '../services/eventConfigService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = $1 WHERE id = 1', [
    SEAT_CAPACITY,
  ]);
}

beforeEach(resetDatabaseState);

test('createBookingRecordWithActiveSeatHold creates a pending booking that reserves a seat', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Jane Doe',
    email: 'jane@example.com',
    phone_number: '+255712345678',
  });

  assert.equal(bookingRecord.status, 'pending');
  assert.equal(bookingRecord.email, 'jane@example.com');
  assert.equal(bookingRecord.utm_source, null);
  assert.ok(bookingRecord.ref.length >= 6);

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.activeSeatHolds, 1);
  assert.equal(availabilitySnapshot.confirmedCount, 0);
  assert.equal(availabilitySnapshot.seatsRemaining, SEAT_CAPACITY - 1);
});

test('createBookingRecordWithActiveSeatHold persists the referral utm_source', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Referred Doe',
    email: 'referred@example.com',
    phone_number: '+255712345685',
    utm_source: 'ref_john_x7k2',
  });

  assert.equal(bookingRecord.utm_source, 'ref_john_x7k2');
});

test('two simultaneous bookings cannot take the last seat', async () => {
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = 1 WHERE id = 1');

  const bookingAttempts = await Promise.allSettled([
    createBookingRecordWithActiveSeatHold({
      full_name: 'First Racer',
      email: 'first-racer@example.com',
      phone_number: '+255712345686',
    }),
    createBookingRecordWithActiveSeatHold({
      full_name: 'Second Racer',
      email: 'second-racer@example.com',
      phone_number: '+255712345687',
    }),
  ]);

  const successfulBookings = bookingAttempts.filter(
    (bookingAttempt) => bookingAttempt.status === 'fulfilled'
  );
  const rejectedBookings = bookingAttempts.filter(
    (bookingAttempt) => bookingAttempt.status === 'rejected'
  );

  assert.equal(successfulBookings.length, 1);
  assert.equal(rejectedBookings.length, 1);
  assert.equal(rejectedBookings[0].reason.code, 'SOLD_OUT');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.seatsRemaining, 0);
});

test('checkSeatAvailabilityBeforeBooking throws SoldOutError when caps are exhausted', async () => {
  await pool.query('UPDATE seat_capacity SET confirmed_count = $1 WHERE id = 1', [SEAT_CAPACITY]);

  await assert.rejects(
    () => checkSeatAvailabilityBeforeBooking(),
    (error) => error instanceof SoldOutError && error.code === 'SOLD_OUT'
  );
});

test('confirmBookingSeatWithinCapacity confirms booking and increments seat counter', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'John Smith',
    email: 'john@example.com',
    phone_number: '+255712345679',
  });

  const confirmedBooking = await confirmBookingSeatWithinCapacity(bookingRecord.id);

  assert.equal(confirmedBooking.status, 'confirmed');

  const capacitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(capacitySnapshot.confirmedCount, 1);
  assert.equal(capacitySnapshot.activeSeatHolds, 0);
});

test('confirmBookingSeatWithinCapacity rejects confirmation once cap is reached', async () => {
  const expiredHoldBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Ready User',
    email: 'ready@example.com',
    phone_number: '+255712345680',
  });

  await pool.query('UPDATE seat_capacity SET confirmed_count = $1 WHERE id = 1', [SEAT_CAPACITY]);

  await assert.rejects(
    () => confirmBookingSeatWithinCapacity(expiredHoldBooking.id),
    (error) => error instanceof SoldOutError && error.code === 'SOLD_OUT'
  );
});

test('expireAllExpiredSeatHolds marks stale pending bookings as expired', async () => {  const staleBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Stale User',
    email: 'stale@example.com',
    phone_number: '+255712345681',
  });

  await pool.query('UPDATE bookings SET expires_at = now() - interval \'1 minute\' WHERE id = $1', [
    staleBooking.id,
  ]);

  const expiredCount = await expireAllExpiredSeatHolds();
  assert.equal(expiredCount, 1);

  const result = await pool.query('SELECT status FROM bookings WHERE id = $1', [staleBooking.id]);
  assert.equal(result.rows[0].status, 'expired');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.activeSeatHolds, 0);
});

test('extendBookingSeatHoldForOfflinePaymentReview extends a live Lipa Namba hold', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Offline Payer',
    email: 'offline-payer@example.com',
    phone_number: '+255712345689',
  });

  const isSeatHoldActive = await extendBookingSeatHoldForOfflinePaymentReview(
    bookingRecord.id
  );

  assert.equal(isSeatHoldActive, true);

  const result = await pool.query(
    'SELECT status, expires_at FROM bookings WHERE id = $1',
    [bookingRecord.id]
  );
  const remainingHoldMinutes =
    (new Date(result.rows[0].expires_at).getTime() - Date.now()) / 60000;

  assert.equal(result.rows[0].status, 'pending');
  assert.ok(remainingHoldMinutes > OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES - 1);
});

test('extendBookingSeatHoldForOfflinePaymentReview reactivates an expired hold when a seat is free', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Expired Offline Payer',
    email: 'expired-offline-payer@example.com',
    phone_number: '+255712345690',
  });
  await pool.query(
    "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [bookingRecord.id]
  );
  await expireAllExpiredSeatHolds();

  const isSeatHoldActive = await extendBookingSeatHoldForOfflinePaymentReview(
    bookingRecord.id
  );

  assert.equal(isSeatHoldActive, true);

  const result = await pool.query(
    'SELECT status, expires_at FROM bookings WHERE id = $1',
    [bookingRecord.id]
  );
  assert.equal(result.rows[0].status, 'pending');
  assert.ok(new Date(result.rows[0].expires_at).getTime() > Date.now());
});

test('extendBookingSeatHoldForOfflinePaymentReview reports failure when the event is full', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'No Seat Offline Payer',
    email: 'no-seat-offline-payer@example.com',
    phone_number: '+255712345691',
  });
  await pool.query(
    "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [bookingRecord.id]
  );
  await expireAllExpiredSeatHolds();
  await pool.query('UPDATE seat_capacity SET confirmed_count = $1 WHERE id = 1', [
    SEAT_CAPACITY,
  ]);

  const isSeatHoldActive = await extendBookingSeatHoldForOfflinePaymentReview(
    bookingRecord.id
  );

  assert.equal(isSeatHoldActive, false);
});

test('updateBookingStatus allows the documented booking transitions', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Transition User',
    email: 'transition@example.com',
    phone_number: '+255712345680',
  });

  const cancelledBooking = await updateBookingStatus(bookingRecord.id, 'cancelled');
  assert.equal(cancelledBooking.status, 'cancelled');

  const revivedBooking = await updateBookingStatus(bookingRecord.id, 'pending');
  assert.equal(revivedBooking.status, 'pending');
});

test('updateBookingStatus refuses to release a confirmed seat by moving it back to pending', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Confirmed Seat User',
    email: 'confirmedseat@example.com',
    phone_number: '+255712345681',
  });
  await confirmBookingSeatWithinCapacity(bookingRecord.id);

  await assert.rejects(
    () => updateBookingStatus(bookingRecord.id, 'pending'),
    (error) => error.code === 'BOOKING_STATUS_TRANSITION_NOT_ALLOWED'
  );

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 1);
});

test('updateBookingStatus treats an unchanged status as a no-op', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Noop User',
    email: 'noop@example.com',
    phone_number: '+255712345682',
  });

  const unchangedBooking = await updateBookingStatus(bookingRecord.id, 'pending');
  assert.equal(unchangedBooking.id, bookingRecord.id);
  assert.equal(unchangedBooking.status, 'pending');
});
