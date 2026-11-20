import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBookingLookupPaymentPreparationStep } from '../lib/bookingLookupPaymentPreparation.js';

test('a pending booking that already started a payment resumes it without a method selection', () => {
  const preparationStep = resolveBookingLookupPaymentPreparationStep(
    { booking: { status: 'pending' }, payment: { public_token: 'payment-token-123' } },
    null
  );

  assert.equal(preparationStep.existingPaymentPublicToken, 'payment-token-123');
  assert.equal(preparationStep.requiresPaymentMethodSelection, undefined);
  assert.equal(preparationStep.paymentMethodToCreatePayment, undefined);
});

test('a booking without a payment asks for a method before creating one', () => {
  const preparationStep = resolveBookingLookupPaymentPreparationStep(
    { booking: { status: 'pending' }, payment: null },
    null
  );

  assert.equal(preparationStep.requiresPaymentMethodSelection, true);
  assert.equal(preparationStep.existingPaymentPublicToken, undefined);
});

test('a booking without a payment creates it with the selected method', () => {
  const preparationStep = resolveBookingLookupPaymentPreparationStep(
    { booking: { status: 'pending' }, payment: null },
    'lipanamba'
  );

  assert.equal(preparationStep.paymentMethodToCreatePayment, 'lipanamba');
  assert.equal(preparationStep.requiresPaymentMethodSelection, undefined);
});
