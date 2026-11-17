import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createApplication } from '../app.js';
import pool from '../config/db.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

let httpServer;
let apiBaseUrl;

before(async () => {
  httpServer = createApplication().listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));
  apiBaseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
});

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = 150 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createBookingAndPayment() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Route Level Attendee',
    email: 'route.level@example.com',
    phone_number: '+255712345901',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'lipanamba'
  );
  return { bookingRecord, paymentRecord };
}

test('GET /api/payments/:paymentPublicToken serves the payment without contact fields', async () => {
  const { paymentRecord } = await createBookingAndPayment();

  const response = await fetch(`${apiBaseUrl}/api/payments/${paymentRecord.public_token}`);
  const responseBody = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control').includes('no-store'), true);
  assert.equal(responseBody.booking.email, undefined);
  assert.equal(responseBody.booking.phone_number, undefined);
  assert.equal(responseBody.payment.booking_id, undefined);
});

test('GET /api/payments/:id rejects a legacy sequential payment id with 404', async () => {
  const { paymentRecord } = await createBookingAndPayment();

  const response = await fetch(`${apiBaseUrl}/api/payments/${paymentRecord.id}`);
  const responseBody = await response.json();

  assert.equal(response.status, 404);
  assert.equal(responseBody.message, 'Payment not found');
});

test('POST /api/payments/:id/initiate-usdt rejects a legacy sequential payment id', async () => {
  const { paymentRecord } = await createBookingAndPayment();

  const response = await fetch(
    `${apiBaseUrl}/api/payments/${paymentRecord.id}/initiate-usdt`,
    { method: 'POST' }
  );

  assert.equal(response.status, 404);
});

test('GET /api/bookings/:id no longer exists, so it cannot hand out a booking reference', async () => {
  const { bookingRecord, paymentRecord } = await createBookingAndPayment();

  const response = await fetch(`${apiBaseUrl}/api/bookings/${bookingRecord.id}`);

  assert.equal(response.status, 404);
  assert.notEqual(paymentRecord.public_token, String(bookingRecord.id));
});

test('POST /api/payments requires the booking reference before creating a payment', async () => {
  const { bookingRecord } = await createBookingAndPayment();
  await pool.query('DELETE FROM payments WHERE booking_id = $1', [bookingRecord.id]);

  const response = await fetch(`${apiBaseUrl}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      booking_id: bookingRecord.id,
      payment_method: 'lipanamba',
    }),
  });
  const responseBody = await response.json();

  assert.equal(response.status, 400);
  assert.match(responseBody.message, /booking_ref/);
});
