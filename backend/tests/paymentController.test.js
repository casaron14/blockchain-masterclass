import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import paymentController from '../controller/paymentController.js';
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

test('createPaymentRecord rejects an unsupported payment method with 400', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Unsupported Method Attendee',
    email: 'unsupported-method@example.com',
    phone_number: '+255712345701',
  });
  const response = createMockResponse();

  await paymentController.createPaymentRecord(
    {
      body: {
        booking_id: bookingRecord.id,
        booking_ref: bookingRecord.ref,
        payment_method: 'mpesa',
      },
    },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /Invalid payment method/);
});
