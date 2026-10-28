import fs from 'node:fs';

import {
  buildTicketEmailDeliveryFailureMessage,
  resendTicketEmailToAttendeeFromAdmin,
  TICKET_EMAIL_DELIVERY_DISABLED_REASON,
  TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON,
  TICKET_EMAIL_DAILY_LIMIT_REACHED_REASON,
  TICKET_EMAIL_INVALID_RECIPIENT_REASON,
  TICKET_EMAIL_SEND_IN_PROGRESS_REASON,
} from '../services/ticketDeliveryService.js';
import { fetchBookingRecordByReferenceCode } from '../services/bookingService.js';
import { generateTicketPdfBuffer } from '../services/ticketPdfService.js';
import { fetchPaymentReceiptByBookingId } from '../services/paymentReceiptService.js';
import { PRIMARY_EVENT_SLUG } from '../services/eventConfigService.js';
import { bookingNotFoundResponse } from '../utils/responseHelpers.js';

function ticketNotFoundResponse() {
  return { message: 'Ticket not found' };
}

async function resendTicketEmailToAttendeeEndpoint(req, res) {
  const bookingId = parseInt(req.params.bookingId, 10);

  try {
    const deliveryResult = await resendTicketEmailToAttendeeFromAdmin(bookingId);

    if (!deliveryResult) {
      return res.status(404).json(ticketNotFoundResponse());
    }

    if (deliveryResult.skipped) {
      const skipMessageByReason = {
        [TICKET_EMAIL_DELIVERY_DISABLED_REASON]:
          'Email delivery is disabled; the attendee downloads the ticket from the booking lookup',
        [TICKET_EMAIL_SEND_IN_PROGRESS_REASON]:
          'A previous ticket email attempt is still marked as in progress. Wait up to 15 minutes and retry; if the email did not arrive, check the ticket delivery log',
        [TICKET_EMAIL_INVALID_RECIPIENT_REASON]:
          'This booking has no valid attendee email address',
        [TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON]:
          'The hourly sending limit has been reached; try again later',
        [TICKET_EMAIL_DAILY_LIMIT_REACHED_REASON]:
          'The daily sending limit has been reached; try again tomorrow',
      };

      return res.status(409).json({
        message:
          skipMessageByReason[deliveryResult.reason] ??
          'Ticket is only available for confirmed bookings',
        bookingId: deliveryResult.bookingId,
        reason: deliveryResult.reason ?? null,
      });
    }

    if (!deliveryResult.delivered) {
      return res.status(502).json({
        message: buildTicketEmailDeliveryFailureMessage(deliveryResult.reason),
        bookingId: deliveryResult.bookingId,
        reason: deliveryResult.reason,
      });
    }

    return res.status(200).json({
      message: 'Ticket email sent',
      bookingId: deliveryResult.bookingId,
      deliveryId: deliveryResult.deliveryId,
    });
  } catch (error) {
    console.error('Error resending ticket email', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function downloadTicketPdfEndpoint(req, res) {
  const bookingReferenceCode = req.params.bookingRef;

  try {
    const bookingRecord = await fetchBookingRecordByReferenceCode(bookingReferenceCode);

    if (!bookingRecord) {
      return res.status(404).json(bookingNotFoundResponse());
    }

    if (bookingRecord.status !== 'confirmed') {
      return res.status(403).json({ message: 'Ticket is only available for confirmed bookings' });
    }

    const pdfBuffer = await generateTicketPdfBuffer(bookingRecord);

    const safeFilename = `${PRIMARY_EVENT_SLUG}-ticket-${bookingRecord.ref}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': pdfBuffer.length,
    });

    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating ticket PDF', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

// The stored receipt, not a freshly rendered one: the PDF that was emailed is
// the PDF that is served, so an attendee comparing them sees the same document
// with the same transaction details.
async function downloadPaymentReceiptEndpoint(req, res) {
  const bookingReferenceCode = req.params.bookingRef;

  try {
    const bookingRecord = await fetchBookingRecordByReferenceCode(bookingReferenceCode);
    if (!bookingRecord) {
      return res.status(404).json(bookingNotFoundResponse());
    }

    if (bookingRecord.status !== 'confirmed') {
      return res
        .status(403)
        .json({ message: 'Receipt is only available for confirmed bookings' });
    }

    const receiptRecord = await fetchPaymentReceiptByBookingId(bookingRecord.id);
    if (!receiptRecord) {
      return res.status(404).json({ message: 'Receipt is not available yet' });
    }

    const safeFilename = `${PRIMARY_EVENT_SLUG}-receipt-${bookingRecord.ref}.pdf`;

    if (receiptRecord.pdfPath && fs.existsSync(receiptRecord.pdfPath)) {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      });
      return res.sendFile(receiptRecord.pdfPath);
    }

    const { generatePaymentReceiptPdfBuffer } = await import(
      '../services/paymentReceiptPdfService.js'
    );
    const { fetchPaymentRecordByBookingId } = await import('../services/paymentService.js');
    const { resolveEventDetailsForReceipt } = await import(
      '../services/paymentReceiptService.js'
    );
    const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
    const receiptPdfBuffer = await generatePaymentReceiptPdfBuffer({
      bookingRecord,
      paymentRecord,
      receiptRecord,
      eventDetails: resolveEventDetailsForReceipt(),
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': receiptPdfBuffer.length,
    });
    return res.send(receiptPdfBuffer);
  } catch (error) {
    console.error('Error generating payment receipt PDF', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

export default {
  resendTicketEmailToAttendeeEndpoint,
  downloadTicketPdfEndpoint,
  downloadPaymentReceiptEndpoint,
};
