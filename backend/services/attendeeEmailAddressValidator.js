// Delivery must only ever address the email stored on the booking. No public
// route accepts a recipient, and this validator is the last server-side check
// before Nodemailer is called.
//
// The database has a format CHECK constraint too, but old rows can predate it
// or contain a placeholder. Treating a missing/malformed address as a delivery
// failure is safer than handing it to Gmail.

const MAXIMUM_EMAIL_ADDRESS_LENGTH = 254;
const MAXIMUM_LOCAL_PART_LENGTH = 64;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export class InvalidAttendeeEmailAddressError extends Error {
  constructor(bookingId, attendeeEmailAddress) {
    super(
      `INVALID_ATTENDEE_EMAIL_ADDRESS: booking ${bookingId} has no usable email address`
    );
    this.name = 'InvalidAttendeeEmailAddressError';
    this.code = 'INVALID_ATTENDEE_EMAIL_ADDRESS';
    this.bookingId = bookingId;
    this.attendeeEmailAddress = attendeeEmailAddress;
  }
}

export function isValidAttendeeEmailAddress(attendeeEmailAddress) {
  const normalizedEmailAddress = String(attendeeEmailAddress ?? '').trim();

  if (!normalizedEmailAddress || normalizedEmailAddress.length > MAXIMUM_EMAIL_ADDRESS_LENGTH) {
    return false;
  }

  if (!EMAIL_ADDRESS_PATTERN.test(normalizedEmailAddress)) {
    return false;
  }

  const [localPart, domainPart] = normalizedEmailAddress.split('@');
  if (!localPart || localPart.length > MAXIMUM_LOCAL_PART_LENGTH || !domainPart) {
    return false;
  }

  return true;
}

export function validateAttendeeEmailAddressForTicketDelivery(bookingRecord) {
  const attendeeEmailAddress = String(bookingRecord?.email ?? '').trim();

  if (!isValidAttendeeEmailAddress(attendeeEmailAddress)) {
    throw new InvalidAttendeeEmailAddressError(bookingRecord?.id ?? null, attendeeEmailAddress);
  }

  return attendeeEmailAddress;
}
