import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import bookingController from '../controller/bookingController.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

function createMockResponse() {
  const capturedResponse = { statusCode: null, body: null };

  return {
    status(statusCode) {
      capturedResponse.statusCode = statusCode;
      return this;
    },
    json(body) {
      capturedResponse.body = body;
      return this;
    },
    capturedResponse,
  };
}

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = 150 WHERE id = 1');
}

beforeEach(resetDatabaseState);

test('getBookingDetailsForReferenceLookup rejects a missing reference with 400', async () => {
  const response = createMockResponse();

  await bookingController.getBookingDetailsForReferenceLookup({ params: {} }, response);

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /Booking reference/);
});

test('getBookingRecordByReferenceCode returns 404 when no booking matches', async () => {
  const response = createMockResponse();

  await bookingController.getBookingRecordByReferenceCode(
    { params: { ref: 'ZZZZZZ' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Booking not found');
});

test('createBookingRecord returns the sold-out response once the seat cap is reached', async () => {
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = 0 WHERE id = 1');
  const response = createMockResponse();

  await bookingController.createBookingRecord(
    {
      body: {
        full_name: 'Sold Out Attendee',
        email: 'sold-out@example.com',
        phone_number: '+255712345690',
      },
    },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.message, 'Event is sold out');
});

test('createBookingRecord rejects invalid attendee details before writing to the database', async () => {
  const response = createMockResponse();

  await bookingController.createBookingRecord(
    { body: { full_name: 'A', email: 'not-an-email', phone_number: '123' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.message, 'Validation failed');
});

test('getBookingRecordById exposes only the status fields the payment page needs', async () => {
  const createdBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Private Attendee',
    email: 'private@example.com',
    phone_number: '+255712345681',
  });
  const response = createMockResponse();

  await bookingController.getBookingRecordById(
    { params: { id: String(createdBooking.id) } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.deepEqual(
    Object.keys(response.capturedResponse.body.booking).sort(),
    ['expires_at', 'id', 'ref', 'status']
  );
  assert.equal(response.capturedResponse.body.booking.email, undefined);
  assert.equal(response.capturedResponse.body.booking.phone_number, undefined);
  assert.equal(response.capturedResponse.body.booking.full_name, undefined);
});

test('reactivateBookingHold refuses an id-only request without the booking reference', async () => {
  const createdBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Reference Required Attendee',
    email: 'reference-required@example.com',
    phone_number: '+255712345682',
  });
  const response = createMockResponse();

  await bookingController.reactivateBookingHold(
    { params: { id: String(createdBooking.id) }, body: {} },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /booking_ref/);
});

test('getBookingDetailsForSearchLookup rejects a missing search value with 400', async () => {
  const response = createMockResponse();

  await bookingController.getBookingDetailsForSearchLookup({ query: {} }, response);

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /Search value/);
});

test('getBookingDetailsForSearchLookup rejects a one-character search value with 400', async () => {
  const response = createMockResponse();

  await bookingController.getBookingDetailsForSearchLookup({ query: { q: 'a' } }, response);

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.error, 'INVALID_BOOKING_SEARCH_VALUE');
});

test('getBookingDetailsForSearchLookup returns 404 for an unknown email address', async () => {
  const response = createMockResponse();

  await bookingController.getBookingDetailsForSearchLookup(
    { query: { q: 'nobody@example.com' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Booking not found');
});

test('getBookingDetailsForSearchLookup returns 200 for an email address that matches one booking', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Controller Search User',
    email: 'controller.search@example.com',
    phone_number: '+255712345715',
  });
  const response = createMockResponse();

  await bookingController.getBookingDetailsForSearchLookup(
    { query: { q: 'controller.search@example.com' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.equal(response.capturedResponse.body.booking.id, bookingRecord.id);
  assert.equal(response.capturedResponse.body.actions.canPayNow, true);
});

test('getBookingDetailsForSearchLookup returns 409 when the search matches several bookings', async () => {
  await createBookingRecordWithActiveSeatHold({
    full_name: 'Shared Lookup One',
    email: 'shared.lookup@example.com',
    phone_number: '+255712345716',
  });
  await createBookingRecordWithActiveSeatHold({
    full_name: 'Shared Lookup Two',
    email: 'shared.lookup@example.com',
    phone_number: '+255712345717',
  });
  const response = createMockResponse();

  await bookingController.getBookingDetailsForSearchLookup(
    { query: { q: 'shared.lookup@example.com' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 409);
  assert.equal(response.capturedResponse.body.error, 'AMBIGUOUS_BOOKING_LOOKUP');
  assert.equal(response.capturedResponse.body.matchingBookingCount, 2);
});

test('getBookingDetailsForSearchLookup rejects an attendee name with 400', async () => {
  await createBookingRecordWithActiveSeatHold({
    full_name: 'Named Search User',
    email: 'named.search@example.com',
    phone_number: '+255712345718',
  });
  const response = createMockResponse();

  await bookingController.getBookingDetailsForSearchLookup(
    { query: { q: 'Named Search User' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.error, 'INVALID_BOOKING_SEARCH_VALUE');
});
