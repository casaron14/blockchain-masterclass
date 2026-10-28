// The QR code on every ticket is the attendee's own Inkryptus referral link.
// The print ticket and the emailed ticket import this module so they always
// carry the same URL, and the backend delivery record stores the same value.

export const TICKET_QR_CODE_BASE_URL = 'https://link.inkryptus.com/';

export function buildTicketQrCodeUrl(bookingRecord) {
  const attendeeReferralValue = String(bookingRecord?.utm_source ?? '').trim();
  const ticketQrCodeUrl = new URL(TICKET_QR_CODE_BASE_URL);
  ticketQrCodeUrl.searchParams.set('referral', attendeeReferralValue);
  return ticketQrCodeUrl.toString();
}
