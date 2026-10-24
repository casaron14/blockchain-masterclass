import pool from '../config/db.js';
import QRCode from 'qrcode';

import { fetchBookingRecordById } from './bookingService.js';

import { createConfiguredEmailTransport } from './emailTransportService.js';

import {
  EVENT_TITLE,
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
} from './eventConfigService.js';

export const DEFAULT_EVENT_TITLE = EVENT_TITLE;
export const DEFAULT_EVENT_DATE = EVENT_DATE_LABEL;
export const DEFAULT_EVENT_LOCATION = EVENT_LOCATION;

export const TICKET_EMAIL_DELIVERY_DISABLED_REASON = 'email_delivery_disabled';

// A deployment can run without email: the attendee downloads the ticket PDF
// from the booking lookup. Setting EMAIL_DELIVERY_ENABLED=false stops a
// confirmation from queueing an email attempt that can never succeed, and
// stops the retry job from retrying it. Unset means email is enabled, so
// existing deployments keep their behaviour.
export function isTicketEmailDeliveryEnabled() {
  const configuredDeliveryFlag = process.env.EMAIL_DELIVERY_ENABLED
    ?.trim()
    .toLowerCase();

  if (!configuredDeliveryFlag) {
    return true;
  }

  return !['false', 'off', '0', 'no'].includes(configuredDeliveryFlag);
}

export function getEventDetails() {
  return {
    eventTitle: EVENT_TITLE,
    eventDate: EVENT_DATE_LABEL,
    eventLocation: EVENT_LOCATION,
  };
}

export function buildTicketQrPayload(bookingRecord) {
  const eventDetails = getEventDetails();
  return {
    ticketId: `EVT-${bookingRecord.ref}`,
    bookingReference: bookingRecord.ref,
    attendeeName: bookingRecord.full_name,
    bookingId: bookingRecord.id,
    eventTitle: eventDetails.eventTitle,
    eventDate: eventDetails.eventDate,
    eventLocation: eventDetails.eventLocation,
  };
}

export async function renderTicketQrDataUrl(bookingRecord) {
  const qrPayload = buildTicketQrPayload(bookingRecord);
  return QRCode.toDataURL(JSON.stringify(qrPayload));
}

export function buildTicketEmailHtml(bookingRecord, qrDataUrl) {
  const eventDetails = getEventDetails();
  return `
    <h2>Your ticket for ${eventDetails.eventTitle}</h2>
    <p>Hi ${bookingRecord.full_name},</p>
    <p>Thank you for your booking. Here are your ticket details:</p>
    <table style="border-collapse: collapse;">
      <tr><td><strong>Ticket ID</strong></td><td>EVT-${bookingRecord.ref}</td></tr>
      <tr><td><strong>Booking Reference</strong></td><td>${bookingRecord.ref}</td></tr>
      <tr><td><strong>Event</strong></td><td>${eventDetails.eventTitle}</td></tr>
      <tr><td><strong>Date</strong></td><td>${eventDetails.eventDate}</td></tr>
      <tr><td><strong>Location</strong></td><td>${eventDetails.eventLocation}</td></tr>
    </table>
    <p><img src="${qrDataUrl}" alt="Ticket QR code" style="width: 180px; height: 180px;" /></p>
    <p>Present this QR code at the venue for check-in.</p>
  `;
}

export function buildTicketEmailSubject(bookingRecord) {
  const eventDetails = getEventDetails();
  return `Your ticket for ${eventDetails.eventTitle} (${bookingRecord.ref})`;
}

export function resolveTicketSenderAddress() {
  return process.env.MAIL_FROM || 'tickets@blockchainmasterclass.example';
}

export function buildTicketEmailAttachments(
  ticketPdfBuffer,
  bookingRecord,
  receiptPdfArtifact = null
) {
  const attachments = [
    {
      filename: `ticket-${bookingRecord.ref}.pdf`,
      content: ticketPdfBuffer,
      contentType: 'application/pdf',
    },
  ];

  if (receiptPdfArtifact) {
    attachments.push({
      filename: receiptPdfArtifact.fileName,
      content: receiptPdfArtifact.pdfBuffer,
      contentType: 'application/pdf',
    });
  }

  return attachments;
}

export async function sendTicketEmailToAttendee(bookingRecord, options = {}) {
  const { generateTicketPdfBuffer } = await import('./ticketPdfService.js');

  const qrDataUrl = await renderTicketQrDataUrl(bookingRecord);
  const ticketPdfBuffer = await generateTicketPdfBuffer(
    bookingRecord,
    options.paymentSummary ?? null
  );
  const transport = options.transport ?? (await createConfiguredEmailTransport());
  const fromAddress = resolveTicketSenderAddress();

  await transport.sendMail({
    from: fromAddress,
    to: bookingRecord.email,
    subject: buildTicketEmailSubject(bookingRecord),
    html: buildTicketEmailHtml(bookingRecord, qrDataUrl),
    attachments: buildTicketEmailAttachments(
      ticketPdfBuffer,
      bookingRecord,
      options.receiptPdfArtifact ?? null
    ),
  });

  return { qrDataUrl };
}

async function fetchDeliveryRecordForBooking(bookingId) {
  const result = await pool.query(
    'SELECT * FROM ticket_deliveries WHERE booking_id = $1',
    [bookingId]
  );
  return result.rows[0] ?? null;
}

async function insertDeliveryRecord(bookingId, qrPayload) {
  const result = await pool.query(
    `INSERT INTO ticket_deliveries (booking_id, qr_payload)
     VALUES ($1, $2)
     RETURNING *`,
    [bookingId, JSON.stringify(qrPayload)]
  );
  return result.rows[0];
}

async function markDeliverySent(deliveryId) {
  await pool.query(
    `UPDATE ticket_deliveries
        SET status = 'sent', last_error = NULL, sent_at = now(), updated_at = now(),
            attempt_count = attempt_count + 1
      WHERE id = $1`,
    [deliveryId]
  );
}

async function markDeliveryFailed(deliveryId, errorMessage) {
  await pool.query(
    `UPDATE ticket_deliveries
        SET status = 'failed', last_error = $1, updated_at = now(),
            attempt_count = attempt_count + 1
      WHERE id = $2`,
    [errorMessage, deliveryId]
  );
}

export async function fetchFailedTicketDeliveryRecordsBelowMaxAttempts(maxAttempts) {
  const result = await pool.query(
    `SELECT td.*
       FROM ticket_deliveries td
       JOIN bookings b ON b.id = td.booking_id
      WHERE td.status = 'failed'
        AND b.status = 'confirmed'
        AND td.attempt_count < $1
      ORDER BY td.updated_at ASC`,
    [maxAttempts]
  );
  return result.rows;
}

export function resolveTicketDeliveryMaxAttempts() {
  return Number(process.env.TICKET_DELIVERY_MAX_ATTEMPTS || 5);
}

// The receipt PDF is produced (not marked issued) before the ticket email goes
// out, so both artefacts travel in the same message. Marking the receipt issued
// is left to the receipt email delivery that follows.
async function buildReceiptPdfAttachmentForTicketEmail(bookingId, receiptRecord) {
  const { buildPaymentReceiptPdfArtifactForBooking } = await import(
    './paymentReceiptService.js'
  );

  return buildPaymentReceiptPdfArtifactForBooking(bookingId, receiptRecord);
}

export async function deliverPaymentReceiptAfterTicketDelivery(
  bookingId,
  receiptRecord,
  builtReceiptPdf,
  deliverReceiptEmail
) {
  if (!receiptRecord) {
    return null;
  }

  try {
    const receiptDeliveryResult = await deliverReceiptEmail(bookingId, {
      receiptRecord,
      fileName: builtReceiptPdf.fileName,
      pdfBuffer: builtReceiptPdf.pdfBuffer,
      filePath: builtReceiptPdf.filePath,
      pdfSha256: builtReceiptPdf.sha256,
    });
    return { delivered: true, receiptId: receiptDeliveryResult.receiptId };
  } catch (error) {
    return {
      delivered: false,
      receiptId: receiptRecord.id,
      reason: error.message || 'Unknown receipt email delivery error',
    };
  }
}

export async function deliverTicketForConfirmedBooking(
  bookingId,
  sendTicketEmail = sendTicketEmailToAttendee,
  deliveryOptions = {}
) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    return null;
  }

  if (bookingRecord.status !== 'confirmed') {
    return { skipped: true, bookingId: bookingRecord.id };
  }

  if (!isTicketEmailDeliveryEnabled()) {
    // No delivery row is written: the ticket is generated from the booking on
    // demand by GET /api/tickets/:bookingRef/download, so there is nothing to
    // retry and nothing the retry job can pick up.
    return {
      delivered: false,
      skipped: true,
      reason: TICKET_EMAIL_DELIVERY_DISABLED_REASON,
      bookingId: bookingRecord.id,
    };
  }

  const qrPayload = buildTicketQrPayload(bookingRecord);

  const existingDeliveryRecord = await fetchDeliveryRecordForBooking(bookingId);
  const deliveryRecord =
    existingDeliveryRecord ?? (await insertDeliveryRecord(bookingId, qrPayload));

  const receiptRecord = deliveryOptions.receiptRecord ?? null;
  const deliverReceiptEmail = deliveryOptions.deliverReceiptEmail ?? null;
  const builtReceiptPdf = receiptRecord
    ? await buildReceiptPdfAttachmentForTicketEmail(bookingId, receiptRecord)
    : null;

  try {
    await sendTicketEmail(bookingRecord, {
      receiptPdfArtifact: builtReceiptPdf,
      paymentSummary: deliveryOptions.paymentSummary ?? null,
    });
    await markDeliverySent(deliveryRecord.id);

    const receiptDelivery =
      builtReceiptPdf && deliverReceiptEmail
        ? await deliverPaymentReceiptAfterTicketDelivery(
            bookingId,
            receiptRecord,
            builtReceiptPdf,
            deliverReceiptEmail
          )
        : null;

    return {
      delivered: true,
      deliveryId: deliveryRecord.id,
      bookingId: bookingRecord.id,
      receipt: receiptDelivery,
    };
  } catch (error) {
    const errorMessage = error.message || 'Unknown email delivery error';
    await markDeliveryFailed(deliveryRecord.id, errorMessage);
    return {
      delivered: false,
      deliveryId: deliveryRecord.id,
      bookingId: bookingRecord.id,
      reason: errorMessage,
    };
  }
}

export async function redeliverFailedTicketEmail(bookingId, sendTicketEmail = sendTicketEmailToAttendee) {
  const bookingRecord = await fetchBookingRecordById(bookingId);
  if (!bookingRecord) {
    return null;
  }

  if (bookingRecord.status !== 'confirmed') {
    return { skipped: true, bookingId: bookingRecord.id };
  }

  if (!isTicketEmailDeliveryEnabled()) {
    return {
      delivered: false,
      skipped: true,
      reason: TICKET_EMAIL_DELIVERY_DISABLED_REASON,
      bookingId: bookingRecord.id,
    };
  }

  const existingDeliveryRecord = await fetchDeliveryRecordForBooking(bookingId);

  if (!existingDeliveryRecord) {
    return deliverTicketForConfirmedBooking(bookingId, sendTicketEmail);
  }

  try {
    await sendTicketEmail(bookingRecord);
    await markDeliverySent(existingDeliveryRecord.id);
    return {
      delivered: true,
      deliveryId: existingDeliveryRecord.id,
      bookingId: bookingRecord.id,
    };
  } catch (error) {
    const errorMessage = error.message || 'Unknown email delivery error';
    await markDeliveryFailed(existingDeliveryRecord.id, errorMessage);
    return {
      delivered: false,
      deliveryId: existingDeliveryRecord.id,
      bookingId: bookingRecord.id,
      reason: errorMessage,
    };
  }
}
