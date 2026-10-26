// Interprets the single search box shared by the attendee booking lookup page
// and the admin booking list. Attendee names are matched only when the caller
// explicitly opts in, because the public lookup page must not reveal a booking
// to anyone who merely guesses an attendee's name.

export const BOOKING_SEARCH_IDENTIFIER_KINDS = Object.freeze({
  REFERENCE_CODE: 'reference_code',
  EMAIL_ADDRESS: 'email_address',
  PHONE_NUMBER: 'phone_number',
  ATTENDEE_NAME: 'attendee_name',
});

const PUBLIC_BOOKING_SEARCH_DESCRIPTION =
  'Enter a booking reference, email address, or phone number.';

export const MINIMUM_BOOKING_SEARCH_VALUE_LENGTH = 2;
export const MAXIMUM_BOOKING_SEARCH_VALUE_LENGTH = 120;

const BOOKING_REFERENCE_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_NUMBER_PATTERN = /^\+?[0-9][0-9\s().-]{6,19}$/;
const MINIMUM_PHONE_NUMBER_DIGIT_COUNT = 9;

export class InvalidBookingSearchValueError extends Error {
  constructor(searchValue, invalidReason) {
    super(invalidReason);
    this.name = 'InvalidBookingSearchValueError';
    this.code = 'INVALID_BOOKING_SEARCH_VALUE';
    this.searchValue = searchValue;
  }
}

function collapseRepeatedWhitespace(textValue) {
  return textValue.replace(/\s+/g, ' ');
}

function stripNonDigitCharacters(textValue) {
  return textValue.replace(/[^0-9]/g, '');
}

export function resolveBookingSearchIdentifier(
  rawSearchValue,
  { allowAttendeeNameSearch = false } = {}
) {
  const trimmedSearchValue =
    typeof rawSearchValue === 'string' ? rawSearchValue.trim() : '';

  if (trimmedSearchValue.length < MINIMUM_BOOKING_SEARCH_VALUE_LENGTH) {
    throw new InvalidBookingSearchValueError(
      trimmedSearchValue,
      PUBLIC_BOOKING_SEARCH_DESCRIPTION
    );
  }

  if (trimmedSearchValue.length > MAXIMUM_BOOKING_SEARCH_VALUE_LENGTH) {
    throw new InvalidBookingSearchValueError(
      trimmedSearchValue,
      `Search text must be at most ${MAXIMUM_BOOKING_SEARCH_VALUE_LENGTH} characters.`
    );
  }

  // An email address is unambiguous, so a malformed one is an input mistake
  // rather than a name that happens to contain an @ sign.
  if (trimmedSearchValue.includes('@')) {
    if (!EMAIL_ADDRESS_PATTERN.test(trimmedSearchValue)) {
      throw new InvalidBookingSearchValueError(
        trimmedSearchValue,
        'Enter a complete email address, for example attendee@example.com.'
      );
    }
    return {
      kind: BOOKING_SEARCH_IDENTIFIER_KINDS.EMAIL_ADDRESS,
      normalizedValue: trimmedSearchValue.toLowerCase(),
    };
  }

  if (PHONE_NUMBER_PATTERN.test(trimmedSearchValue)) {
    const phoneNumberDigits = stripNonDigitCharacters(trimmedSearchValue);
    if (phoneNumberDigits.length >= MINIMUM_PHONE_NUMBER_DIGIT_COUNT) {
      return {
        kind: BOOKING_SEARCH_IDENTIFIER_KINDS.PHONE_NUMBER,
        normalizedValue: extractComparablePhoneNumberDigits(phoneNumberDigits),
      };
    }
  }

  const upperCasedSearchValue = trimmedSearchValue.toUpperCase();
  if (BOOKING_REFERENCE_CODE_PATTERN.test(upperCasedSearchValue)) {
    return {
      kind: BOOKING_SEARCH_IDENTIFIER_KINDS.REFERENCE_CODE,
      normalizedValue: upperCasedSearchValue,
    };
  }

  if (!allowAttendeeNameSearch) {
    throw new InvalidBookingSearchValueError(
      trimmedSearchValue,
      PUBLIC_BOOKING_SEARCH_DESCRIPTION
    );
  }

  return {
    kind: BOOKING_SEARCH_IDENTIFIER_KINDS.ATTENDEE_NAME,
    normalizedValue: collapseRepeatedWhitespace(trimmedSearchValue),
  };
}

// Phone numbers are stored in whichever format the attendee typed (+255... or
// 0755...), so the subscriber part is the only stable part to compare against.
export function extractComparablePhoneNumberDigits(phoneNumberValue) {
  const phoneNumberDigits = stripNonDigitCharacters(String(phoneNumberValue ?? ''));
  if (phoneNumberDigits.length < MINIMUM_PHONE_NUMBER_DIGIT_COUNT) {
    return phoneNumberDigits;
  }
  return phoneNumberDigits.slice(-MINIMUM_PHONE_NUMBER_DIGIT_COUNT);
}
