import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBookingConfirmationMessage } from '../lib/adminBookingConfirmation.js';

test('resolveBookingConfirmationMessage reports success when the ticket was emailed', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: { delivered: true },
  });

  assert.equal(confirmationMessage.tone, 'success');
  assert.match(confirmationMessage.message, /ticket emailed/i);
});

test('resolveBookingConfirmationMessage reports success when no delivery was attempted', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: null,
  });

  assert.equal(confirmationMessage.tone, 'success');
});

test('resolveBookingConfirmationMessage points to the booking lookup when email is disabled', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: { delivered: false, skipped: true, reason: 'email_delivery_disabled' },
  });

  assert.equal(confirmationMessage.tone, 'success');
  assert.match(confirmationMessage.message, /booking lookup/i);
});

test('resolveBookingConfirmationMessage reports an info message when the ticket email failed', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: { delivered: false },
  });

  assert.equal(confirmationMessage.tone, 'info');
  assert.match(confirmationMessage.message, /could not be sent/i);
});
