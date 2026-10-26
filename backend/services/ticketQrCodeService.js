// The check-in QR code on every ticket is the attendee's own Inkryptus
// referral link. It is built in one place so the printed ticket, the emailed
// ticket and the stored delivery record always carry the same URL.
export const TICKET_QR_CODE_BASE_URL = 'https://link.inkryptus.com/';

export function buildTicketQrCodeUrl(bookingRecord) {
  const attendeeReferralValue = String(bookingRecord?.utm_source ?? '').trim();
  const ticketQrCodeUrl = new URL(TICKET_QR_CODE_BASE_URL);
  ticketQrCodeUrl.searchParams.set('referral', attendeeReferralValue);
  return ticketQrCodeUrl.toString();
}
