import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import paymentController from '../controller/paymentController.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
} from '../services/paymentService.js';

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

async function createBookingAndPayment({
  fullName,
  emailAddress,
  phoneNumber,
  paymentMethod = 'lipanamba',
}) {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: fullName,
    email: emailAddress,
    phone_number: phoneNumber,
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    paymentMethod
  );
  return { bookingRecord, paymentRecord };
}

test('the payment public token exposes the payment and only a safe booking projection', async () => {
  const { bookingRecord, paymentRecord } = await createBookingAndPayment({
    fullName: 'Token Owner',
    emailAddress: 'token.owner@example.com',
    phoneNumber: '+255712345801',
  });
  const response = createMockResponse();

  await paymentController.getPaymentRecordByPublicToken(
    { params: { paymentPublicToken: paymentRecord.public_token } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.deepEqual(
    Object.keys(response.capturedResponse.body.payment).sort(),
    ['amount_expected', 'confirmed_at', 'initiated_at', 'payment_method', 'status']
  );
  assert.deepEqual(
    Object.keys(response.capturedResponse.body.booking).sort(),
    ['expires_at', 'full_name', 'ref', 'status']
  );
  assert.equal(response.capturedResponse.body.booking.ref, bookingRecord.ref);
  assert.equal(response.capturedResponse.body.booking.email, undefined);
  assert.equal(response.capturedResponse.body.booking.phone_number, undefined);
  assert.equal(response.capturedResponse.body.payment.booking_id, undefined);
  assert.equal(response.capturedResponse.body.payment.id, undefined);
  assert.equal(response.capturedResponse.body.payment.reference_id, undefined);
});

test('a sequential payment id no longer resolves to a payment', async () => {
  const { paymentRecord } = await createBookingAndPayment({
    fullName: 'Sequential Probe',
    emailAddress: 'sequential.probe@example.com',
    phoneNumber: '+255712345802',
  });
  const response = createMockResponse();

  await paymentController.getPaymentRecordByPublicToken(
    { params: { paymentPublicToken: String(paymentRecord.id) } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Payment not found');
});

test('an unknown payment public token returns 404', async () => {
  const response = createMockResponse();

  await paymentController.getPaymentRecordByPublicToken(
    { params: { paymentPublicToken: '00000000-0000-4000-8000-000000000000' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Payment not found');
});

test('one payment public token cannot read another attendee payment', async () => {
  const firstAttendee = await createBookingAndPayment({
    fullName: 'First Attendee',
    emailAddress: 'first.attendee@example.com',
    phoneNumber: '+255712345803',
  });
  const secondAttendee = await createBookingAndPayment({
    fullName: 'Second Attendee',
    emailAddress: 'second.attendee@example.com',
    phoneNumber: '+255712345804',
  });
  const response = createMockResponse();

  await paymentController.getPaymentRecordByPublicToken(
    { params: { paymentPublicToken: firstAttendee.paymentRecord.public_token } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.equal(response.capturedResponse.body.booking.ref, firstAttendee.bookingRecord.ref);
  assert.notEqual(response.capturedResponse.body.booking.ref, secondAttendee.bookingRecord.ref);
  assert.notEqual(
    response.capturedResponse.body.booking.full_name,
    secondAttendee.bookingRecord.full_name
  );
});

test('createPaymentRecord refuses a booking id without the matching booking reference', async () => {
  const { bookingRecord } = await createBookingAndPayment({
    fullName: 'Wrong Reference Target',
    emailAddress: 'wrong.reference@example.com',
    phoneNumber: '+255712345805',
  });
  await pool.query('DELETE FROM payments WHERE booking_id = $1', [bookingRecord.id]);
  const response = createMockResponse();

  await paymentController.createPaymentRecord(
    {
      body: {
        booking_id: bookingRecord.id,
        booking_ref: 'ZZZZZZ',
        payment_method: 'lipanamba',
      },
    },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Booking not found');
  assert.equal(await fetchPaymentRecordByBookingId(bookingRecord.id), null);
});

test('createPaymentRecord requires the booking reference in the request body', async () => {
  const { bookingRecord } = await createBookingAndPayment({
    fullName: 'Missing Reference Target',
    emailAddress: 'missing.reference@example.com',
    phoneNumber: '+255712345806',
  });
  await pool.query('DELETE FROM payments WHERE booking_id = $1', [bookingRecord.id]);
  const response = createMockResponse();

  await paymentController.createPaymentRecord(
    {
      body: {
        booking_id: bookingRecord.id,
        payment_method: 'lipanamba',
      },
    },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /booking_ref/);
  assert.equal(await fetchPaymentRecordByBookingId(bookingRecord.id), null);
});
