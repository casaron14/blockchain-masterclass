import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
  reactivateExpiredBookingSeatHold,
  BookingNotExpiredError,
} from '../services/bookingService.js';

import {
  performBookingReferenceLookup,
  buildBookingLookupActions,
} from '../services/bookingLookupService.js';

import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { SEAT_CAPACITY } from '../services/eventConfigService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = $1 WHERE id = 1', [
    SEAT_CAPACITY,
  ]);
}

beforeEach(resetDatabaseState);

test('reactivateExpiredBookingSeatHold returns the booking to pending and extends the hold', async () => {
  const expiredBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Expired User',
    email: 'expired@example.com',
    phone_number: '+255712345691',
  });

  await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', ['expired', expiredBooking.id]);

  const reactivatedBooking = await reactivateExpiredBookingSeatHold(expiredBooking.id);

  assert.equal(reactivatedBooking.status, 'pending');
  assert.ok(new Date(reactivatedBooking.expires_at).getTime() > Date.now());
});

test('reactivateExpiredBookingSeatHold rejects bookings that are not expired', async () => {
  const pendingBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Pending User',
    email: 'pending@example.com',
    phone_number: '+255712345692',
  });

  await assert.rejects(
    () => reactivateExpiredBookingSeatHold(pendingBooking.id),
    (error) => error instanceof BookingNotExpiredError
  );
});

test('performBookingReferenceLookup returns booking, payment and actions', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Lookup User',
    email: 'lookup@example.com',
    phone_number: '+255712345693',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'lipanamba');

  const lookupResult = await performBookingReferenceLookup(bookingRecord.ref);

  assert.ok(lookupResult);
  assert.equal(lookupResult.booking.id, bookingRecord.id);
  assert.equal(lookupResult.payment.booking_id, bookingRecord.id);
  assert.equal(lookupResult.actions.canPayNow, true);
  assert.equal(lookupResult.actions.canDownloadTicket, false);
});

test('performBookingReferenceLookup allows ticket download for confirmed bookings', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Confirmed User',
    email: 'confirmed@example.com',
    phone_number: '+255712345694',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'lipanamba');
  await confirmBookingSeatWithinCapacity(bookingRecord.id);

  const lookupResult = await performBookingReferenceLookup(bookingRecord.ref);

  assert.equal(lookupResult.booking.status, 'confirmed');
  assert.equal(lookupResult.actions.canDownloadTicket, true);
  assert.equal(lookupResult.actions.canPayNow, false);
});

test('performBookingReferenceLookup returns null for an unknown reference', async () => {
  const lookupResult = await performBookingReferenceLookup('ZZZZZZ');
  assert.equal(lookupResult, null);
});

test('buildBookingLookupActions never offers pay now on a sold out event', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Sold Out User',
    email: 'soldout@example.com',
    phone_number: '+255712345695',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');

  await pool.query('UPDATE seat_capacity SET confirmed_count = $1 WHERE id = 1', [SEAT_CAPACITY]);

  const lookupDetails = await performBookingReferenceLookup(bookingRecord.ref);

  assert.equal(lookupDetails.actions.isSoldOut, true);
  assert.equal(lookupDetails.actions.canPayNow, false);
});