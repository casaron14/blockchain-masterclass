// Stable backend import path for the shared ticket QR helper. The print
// ticket, the emailed ticket, and the stored delivery record all build the
// same referral URL from this module.
export {
  TICKET_QR_CODE_BASE_URL,
  buildTicketQrCodeUrl,
} from '../../shared/ticketQrCode.js';
