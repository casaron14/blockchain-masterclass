const PHONE_PATTERN = /^\+?[0-9]{9,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAG_PATTERN = /<[^>]*>/g;
const ANGLE_BRACKET_PATTERN = /[<>]/g;

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 120;

function sanitizeFullNameInput(rawFullName) {
  const withoutControlCharacters = String(rawFullName || '').replace(
    CONTROL_CHARACTER_PATTERN,
    ''
  );
  const withoutHtmlMarkupTags = withoutControlCharacters.replace(HTML_TAG_PATTERN, '');
  const withoutRemainingAngleBrackets = withoutHtmlMarkupTags.replace(
    ANGLE_BRACKET_PATTERN,
    ''
  );
  return withoutRemainingAngleBrackets.replace(/\s+/g, ' ').trim();
}

function sanitizeEmailInput(rawEmail) {
  return String(rawEmail || '')
    .replace(/\s+/g, '')
    .replace(ANGLE_BRACKET_PATTERN, '')
    .toLowerCase();
}

function sanitizePhoneNumberInput(rawPhoneNumber) {
  const withoutControlCharacters = String(rawPhoneNumber || '').replace(
    CONTROL_CHARACTER_PATTERN,
    ''
  );
  const digitsOnly = withoutControlCharacters.replace(/[^\d+]/g, '');
  const withoutRepeatedPlusSigns = digitsOnly.replace(/\+/g, '');
  return digitsOnly.startsWith('+')
    ? `+${withoutRepeatedPlusSigns}`
    : withoutRepeatedPlusSigns;
}

export function sanitizeAttendeeFieldValue(fieldName, rawValue) {
  if (fieldName === 'full_name') {
    return sanitizeFullNameInput(rawValue);
  }
  if (fieldName === 'email') {
    return sanitizeEmailInput(rawValue);
  }
  if (fieldName === 'phone_number') {
    return sanitizePhoneNumberInput(rawValue);
  }
  return rawValue;
}

export function buildSanitizedAttendeePayload(attendeeDetails) {
  return {
    full_name: sanitizeFullNameInput(attendeeDetails.full_name),
    email: sanitizeEmailInput(attendeeDetails.email),
    phone_number: sanitizePhoneNumberInput(attendeeDetails.phone_number),
  };
}

export function validateSingleBookingFormField(fieldName, fieldValue, translateMessage) {
  const fieldErrors = {};

  if (fieldName === 'full_name') {
    const normalizedFullName = String(fieldValue || '').trim();
    if (!normalizedFullName) {
      fieldErrors.full_name = translateMessage('booking.errors.required', {
        field: translateMessage('booking.fullName'),
      });
    } else if (normalizedFullName.length < FULL_NAME_MIN_LENGTH) {
      fieldErrors.full_name = translateMessage('booking.errors.nameTooShort');
    } else if (normalizedFullName.length > FULL_NAME_MAX_LENGTH) {
      fieldErrors.full_name = translateMessage('booking.errors.nameTooLong');
    }
  }

  if (fieldName === 'email') {
    const normalizedEmail = String(fieldValue || '').trim();
    if (!normalizedEmail) {
      fieldErrors.email = translateMessage('booking.errors.required', {
        field: translateMessage('booking.email'),
      });
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      fieldErrors.email = translateMessage('booking.errors.invalidEmail');
    }
  }

  if (fieldName === 'phone_number') {
    const normalizedPhoneNumber = String(fieldValue || '').trim();
    if (!normalizedPhoneNumber) {
      fieldErrors.phone_number = translateMessage('booking.errors.required', {
        field: translateMessage('booking.phoneNumber'),
      });
    } else if (!PHONE_PATTERN.test(normalizedPhoneNumber)) {
      fieldErrors.phone_number = translateMessage('booking.errors.invalidPhone');
    }
  }

  if (fieldName === 'payment_method') {
    if (!fieldValue) {
      fieldErrors.payment_method = translateMessage('booking.errors.required', {
        field: translateMessage('booking.paymentMethod'),
      });
    }
  }

  return fieldErrors;
}

export function validateBookingFormInput(attendeeDetails, selectedPaymentMethod, translateMessage) {
  const validationErrors = {
    ...validateSingleBookingFormField('full_name', attendeeDetails.full_name, translateMessage),
    ...validateSingleBookingFormField('email', attendeeDetails.email, translateMessage),
    ...validateSingleBookingFormField(
      'phone_number',
      attendeeDetails.phone_number,
      translateMessage
    ),
    ...validateSingleBookingFormField(
      'payment_method',
      selectedPaymentMethod,
      translateMessage
    ),
  };
  return validationErrors;
}