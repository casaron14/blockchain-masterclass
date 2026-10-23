import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSanitizedAttendeePayload,
  sanitizeAttendeeFieldValue,
  validateBookingFormInput,
  validateSingleBookingFormField,
} from '../lib/attendeeFormValidation.js';

function createTestTranslateMessage() {
  return (translationKey, translationParams) => {
    if (translationParams && translationParams.field) {
      return `${translationKey}:${translationParams.field}`;
    }
    return translationKey;
  };
}

test('sanitizes the full name by stripping control characters and html markup', () => {
  assert.equal(
    sanitizeAttendeeFieldValue('full_name', '  Anna<br>\n <script>Mwangi  '),
    'Anna Mwangi'
  );
});

test('sanitizes the email by removing whitespace and lowercasing it', () => {
  assert.equal(
    sanitizeAttendeeFieldValue('email', '  ANNA@EXAMPLE.COM  '),
    'anna@example.com'
  );
});

test('sanitizes the phone number by stripping formatting and keeping a single leading plus', () => {
  assert.equal(sanitizeAttendeeFieldValue('phone_number', '+255 712 345 678'), '+255712345678');
  assert.equal(sanitizeAttendeeFieldValue('phone_number', '(255) 712-345-678'), '255712345678');
  assert.equal(sanitizeAttendeeFieldValue('phone_number', '++255712345678'), '+255712345678');
});

test('buildSanitizedAttendeePayload returns sanitized trimmed attendee details', () => {
  const sanitizedPayload = buildSanitizedAttendeePayload({
    full_name: '  Anna <b>Mwangi</b>  ',
    email: '  ANNA@EXAMPLE.COM  ',
    phone_number: '+255 712 345 678',
  });
  assert.deepEqual(sanitizedPayload, {
    full_name: 'Anna Mwangi',
    email: 'anna@example.com',
    phone_number: '+255712345678',
  });
});

test('validateBookingFormInput accepts valid attendee details', () => {
  const translateMessage = createTestTranslateMessage();
  const validationErrors = validateBookingFormInput(
    {
      full_name: 'Anna Mwangi',
      email: 'anna@example.com',
      phone_number: '+255712345678',
    },
    'azampesa',
    translateMessage
  );
  assert.deepEqual(validationErrors, {});
});

test('validateBookingFormInput flags every required field when empty', () => {
  const translateMessage = createTestTranslateMessage();
  const validationErrors = validateBookingFormInput(
    {
      full_name: '',
      email: '',
      phone_number: '',
    },
    null,
    translateMessage
  );
  assert.equal(validationErrors.full_name.includes('booking.errors.required'), true);
  assert.equal(validationErrors.email.includes('booking.errors.required'), true);
  assert.equal(validationErrors.phone_number.includes('booking.errors.required'), true);
  assert.equal(
    validationErrors.payment_method.includes('booking.errors.required'),
    true
  );
});

test('validateBookingFormInput rejects malformed email and phone formats', () => {
  const translateMessage = createTestTranslateMessage();
  const validationErrors = validateBookingFormInput(
    {
      full_name: 'Anna Mwangi',
      email: 'not-an-email',
      phone_number: 'abc123',
    },
    'azampesa',
    translateMessage
  );
  assert.equal(validationErrors.email, 'booking.errors.invalidEmail');
  assert.equal(validationErrors.phone_number, 'booking.errors.invalidPhone');
});

test('validateBookingFormInput rejects a full name that is too short or too long', () => {
  const translateMessage = createTestTranslateMessage();

  const tooShortErrors = validateSingleBookingFormField('full_name', 'A', translateMessage);
  assert.equal(tooShortErrors.full_name, 'booking.errors.nameTooShort');

  const tooLongName = 'A'.repeat(121);
  const tooLongErrors = validateSingleBookingFormField(
    'full_name',
    tooLongName,
    translateMessage
  );
  assert.equal(tooLongErrors.full_name, 'booking.errors.nameTooLong');
});