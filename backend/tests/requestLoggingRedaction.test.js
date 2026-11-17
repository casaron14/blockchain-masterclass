import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactAttendeeAccessCredentialsFromRequestPath } from '../middleware/requestLoggingMiddleware.js';

test('payment public tokens are masked before a request path is logged', () => {
  const loggedPath = redactAttendeeAccessCredentialsFromRequestPath(
    '/api/payments/9f2c1a7b-3d4e-4f5a-8b6c-7d8e9f0a1b2c?x=1'
  );

  assert.equal(loggedPath, '/api/payments/:paymentPublicToken?x=1');
});

test('booking references are masked before a request path is logged', () => {
  const loggedPath = redactAttendeeAccessCredentialsFromRequestPath(
    '/api/tickets/ABC234/download'
  );

  assert.equal(loggedPath, '/api/tickets/:bookingReference/download');
});
