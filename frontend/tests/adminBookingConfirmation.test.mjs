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

test('resolveBookingConfirmationMessage reports that an already ticketed booking was not emailed twice', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: { delivered: false, skipped: true, reason: 'ticket_already_sent' },
  });

  assert.equal(confirmationMessage.tone, 'success');
  assert.match(confirmationMessage.message, /already emailed a ticket/i);
  assert.match(confirmationMessage.message, /no second email/i);
});

test('resolveBookingConfirmationMessage explains the Gmail limit instead of claiming the ticket was sent', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: {
      delivered: false,
      skipped: true,
      reason: 'gmail_hourly_limit_reached',
    },
  });

  assert.equal(confirmationMessage.tone, 'info');
  assert.match(confirmationMessage.message, /daily sending limit/i);
  assert.match(confirmationMessage.message, /Resend ticket email/i);
});

test('resolveBookingConfirmationMessage tells the admin to correct an invalid attendee email', () => {
  const confirmationMessage = resolveBookingConfirmationMessage({
    ticketDelivery: {
      delivered: false,
      skipped: true,
      reason: 'invalid_attendee_email_address',
    },
  });

  assert.equal(confirmationMessage.tone, 'error');
  assert.match(confirmationMessage.message, /email address is not valid/i);
});
