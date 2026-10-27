// Everything the Google Sheet mirror needs to describe one outbound email.
// The delivery key is the idempotency key used by the Apps Script web app, so
// it must be stable for a booking and distinct per email kind: a ticket email
// and a receipt email are two different deliveries for the same booking.

import {
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  EVENT_TITLE,
  LOCAL_CURRENCY_CODE,
  TICKET_PRICE_TZS,
  TICKET_TYPE_LABEL,
} from './eventConfigService.js';

export const EMAIL_DELIVERY_KIND_TICKET = 'ticket';
export const EMAIL_DELIVERY_KIND_RECEIPT = 'receipt';
const SUPPORTED_EMAIL_DELIVERY_KINDS = new Set([
  EMAIL_DELIVERY_KIND_TICKET,
  EMAIL_DELIVERY_KIND_RECEIPT,
]);

export function buildBookingEmailDeliveryMetadata(bookingRecord, emailDeliveryKind) {
  if (!SUPPORTED_EMAIL_DELIVERY_KINDS.has(emailDeliveryKind)) {
    throw new Error(`EMAIL_DELIVERY_KIND_UNSUPPORTED:${emailDeliveryKind}`);
  }

  const bookingReferenceCode = String(bookingRecord?.ref ?? '').trim();

  if (!bookingReferenceCode) {
    throw new Error('EMAIL_DELIVERY_BOOKING_REFERENCE_MISSING');
  }

  return {
    deliveryKey: `${emailDeliveryKind}:${bookingReferenceCode}`,
    emailKind: emailDeliveryKind,
    booking: {
      referenceCode: bookingReferenceCode,
      attendeeName: bookingRecord.full_name ?? '',
      attendeeEmailAddress: bookingRecord.email ?? '',
      attendeePhoneNumber: bookingRecord.phone_number ?? '',
      bookingStatus: bookingRecord.status ?? '',
      bookingCreatedAt: bookingRecord.created_at ?? null,
    },
    event: {
      title: EVENT_TITLE,
      dateLabel: EVENT_DATE_LABEL,
      timeLabel: process.env.EVENT_TIME_LABEL?.trim() || '',
      venue: EVENT_LOCATION,
    },
    ticket: {
      ticketTypeLabel: TICKET_TYPE_LABEL,
      amount: TICKET_PRICE_TZS,
      currency: LOCAL_CURRENCY_CODE,
    },
  };
}
