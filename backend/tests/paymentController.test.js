import { test } from 'node:test';
import assert from 'node:assert/strict';

import paymentController from '../controller/paymentController.js';

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

test('createPaymentRecord rejects an unsupported payment method with 400', async () => {
  const response = createMockResponse();

  await paymentController.createPaymentRecord(
    { body: { booking_id: 1, payment_method: 'mpesa' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /Invalid payment method/);
});
