import test from 'node:test';
import assert from 'node:assert/strict';

import { isPaymentStatusTerminal } from '../lib/paymentStatus.js';

test('stops polling once the payment can no longer change', () => {
  assert.equal(isPaymentStatusTerminal('confirmed'), true);
  assert.equal(isPaymentStatusTerminal('failed'), true);
  assert.equal(isPaymentStatusTerminal('expired'), true);
  assert.equal(isPaymentStatusTerminal('pending'), false);
  assert.equal(isPaymentStatusTerminal('initiating'), false);
  assert.equal(isPaymentStatusTerminal(undefined), false);
});
