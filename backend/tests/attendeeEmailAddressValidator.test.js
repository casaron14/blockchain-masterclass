import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InvalidAttendeeEmailAddressError,
  isValidAttendeeEmailAddress,
  validateAttendeeEmailAddressForTicketDelivery,
} from '../services/attendeeEmailAddressValidator.js';

test('isValidAttendeeEmailAddress accepts a normal attendee address', () => {
  assert.equal(isValidAttendeeEmailAddress('amina.juma@example.co.tz'), true);
  assert.equal(isValidAttendeeEmailAddress('  amina@example.com  '), true);
});

test('isValidAttendeeEmailAddress rejects missing, incomplete and overlong addresses', () => {
  assert.equal(isValidAttendeeEmailAddress(''), false);
  assert.equal(isValidAttendeeEmailAddress('not-an-email'), false);
  assert.equal(isValidAttendeeEmailAddress('amina@example'), false);
  assert.equal(isValidAttendeeEmailAddress('amina@@example.com'), false);
  assert.equal(isValidAttendeeEmailAddress(`${'a'.repeat(65)}@example.com`), false);
});

test('validateAttendeeEmailAddressForTicketDelivery returns the trimmed booking email', () => {
  const validatedEmailAddress = validateAttendeeEmailAddressForTicketDelivery({
    id: 42,
    email: '  amina@example.com ',
  });

  assert.equal(validatedEmailAddress, 'amina@example.com');
});

test('validateAttendeeEmailAddressForTicketDelivery refuses to send without a booking email', () => {
  assert.throws(
    () =>
      validateAttendeeEmailAddressForTicketDelivery({
        id: 42,
        email: 'not-an-email',
      }),
    (error) =>
      error instanceof InvalidAttendeeEmailAddressError &&
      error.code === 'INVALID_ATTENDEE_EMAIL_ADDRESS' &&
      error.bookingId === 42
  );
});
