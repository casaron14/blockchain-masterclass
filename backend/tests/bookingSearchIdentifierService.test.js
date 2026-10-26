import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKING_SEARCH_IDENTIFIER_KINDS,
  InvalidBookingSearchValueError,
  extractComparablePhoneNumberDigits,
  resolveBookingSearchIdentifier,
} from '../services/bookingSearchIdentifierService.js';

test('resolveBookingSearchIdentifier treats an uppercase code as a booking reference', () => {
  const resolvedIdentifier = resolveBookingSearchIdentifier('  ab12cd  ');

  assert.equal(resolvedIdentifier.kind, BOOKING_SEARCH_IDENTIFIER_KINDS.REFERENCE_CODE);
  assert.equal(resolvedIdentifier.normalizedValue, 'AB12CD');
});

test('resolveBookingSearchIdentifier lowercases an email address', () => {
  const resolvedIdentifier = resolveBookingSearchIdentifier('Attendee@Example.COM');

  assert.equal(resolvedIdentifier.kind, BOOKING_SEARCH_IDENTIFIER_KINDS.EMAIL_ADDRESS);
  assert.equal(resolvedIdentifier.normalizedValue, 'attendee@example.com');
});

test('resolveBookingSearchIdentifier reduces a phone number to digits', () => {
  const internationalIdentifier = resolveBookingSearchIdentifier('+255 755 123 456');
  const localIdentifier = resolveBookingSearchIdentifier('0755-123-456');

  assert.equal(internationalIdentifier.kind, BOOKING_SEARCH_IDENTIFIER_KINDS.PHONE_NUMBER);
  assert.equal(internationalIdentifier.normalizedValue, '755123456');
  assert.equal(localIdentifier.kind, BOOKING_SEARCH_IDENTIFIER_KINDS.PHONE_NUMBER);
  assert.equal(localIdentifier.normalizedValue, '755123456');
});

test('resolveBookingSearchIdentifier keeps free text as an attendee name only when allowed', () => {
  const resolvedIdentifier = resolveBookingSearchIdentifier('  Asha   Mwinyi  ', {
    allowAttendeeNameSearch: true,
  });

  assert.equal(resolvedIdentifier.kind, BOOKING_SEARCH_IDENTIFIER_KINDS.ATTENDEE_NAME);
  assert.equal(resolvedIdentifier.normalizedValue, 'Asha Mwinyi');
});

test('resolveBookingSearchIdentifier rejects free text when attendee names are not allowed', () => {
  assert.throws(
    () => resolveBookingSearchIdentifier('Asha Mwinyi'),
    (error) =>
      error instanceof InvalidBookingSearchValueError &&
      error.message === 'Enter a booking reference, email address, or phone number.'
  );
});

test('resolveBookingSearchIdentifier rejects a search value that is too short', () => {
  assert.throws(
    () => resolveBookingSearchIdentifier('a'),
    (error) => error instanceof InvalidBookingSearchValueError
  );
});

test('resolveBookingSearchIdentifier rejects a search value that is too long', () => {
  assert.throws(
    () => resolveBookingSearchIdentifier('a'.repeat(121)),
    (error) => error instanceof InvalidBookingSearchValueError
  );
});

test('resolveBookingSearchIdentifier rejects a malformed email address', () => {
  assert.throws(
    () => resolveBookingSearchIdentifier('attendee@'),
    (error) => error instanceof InvalidBookingSearchValueError
  );
});

test('extractComparablePhoneNumberDigits compares only the subscriber part', () => {
  assert.equal(extractComparablePhoneNumberDigits('+255755123456'), '755123456');
  assert.equal(extractComparablePhoneNumberDigits('0755 123 456'), '755123456');
  assert.equal(extractComparablePhoneNumberDigits('+255712345678'), '712345678');
});
