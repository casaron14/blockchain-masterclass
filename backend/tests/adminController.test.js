import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import adminController from '../controller/adminController.js';

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

// Admin writes arrive through a JSON body parser. When a request reaches the
// controller without a parsed body (for example a proxy that forwards the
// payload as text/plain), the endpoint must answer 400 and never crash.

test('updateAdminBookingEndpoint answers 400 when the request body was not parsed', async () => {
  const response = createMockResponse();

  await adminController.updateAdminBookingEndpoint(
    { params: { id: '42' }, body: undefined },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.message, 'Validation failed');
});

test('updateAdminBookingEndpoint answers 400 when the request body is empty', async () => {
  const response = createMockResponse();

  await adminController.updateAdminBookingEndpoint(
    { params: { id: '42' }, body: {} },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.message, 'Validation failed');
});

test('createAdminBookingEndpoint answers 400 when the request body was not parsed', async () => {
  const response = createMockResponse();

  await adminController.createAdminBookingEndpoint(
    { body: undefined },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.equal(response.capturedResponse.body.message, 'Validation failed');
});

test('confirmAdminBookingEndpoint answers 404 when the booking does not exist', async () => {
  const response = createMockResponse();

  await adminController.confirmAdminBookingEndpoint(
    { params: { id: '999999999' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Booking not found');
});
