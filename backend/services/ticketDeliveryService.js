import pool from '../config/db.js';
import QRCode from 'qrcode';

import { fetchBookingRecordById } from './bookingService.js';

import {
  EMAIL_PROVIDER_APPS_SCRIPT,
  resolveEmailTransportProviderName,
  resolveOutboundEmailSenderIdentity,
  sendOutboundEmailThroughConfiguredProvider,
} from './emailTransportService.js';
import {
  EMAIL_DELIVERY_KIND_TICKET,
  buildBookingEmailDeliveryMetadata,
} from './bookingEmailDeliveryMetadataService.js';
import { buildTicketQrCodeUrl } from './ticketQrCodeService.js';
import {
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  EVENT_TITLE,
  PLATFORM_BRAND_NAME,
} from './eventConfigService.js';
import {
  InvalidAttendeeEmailAddressError,
  validateAttendeeEmailAddressForTicketDelivery,
} from './attendeeEmailAddressValidator.js';
import { logError, logWarning } from '../utils/applicationLogger.js';

export const DEFAULT_EVENT_TITLE = EVENT_TITLE;
export const DEFAULT_EVENT_DATE = EVENT_DATE_LABEL;
export const DEFAULT_EVENT_LOCATION = EVENT_LOCATION;

export const TICKET_EMAIL_DELIVERY_DISABLED_REASON = 'email_delivery_disabled';
export const TICKET_EMAIL_ALREADY_SENT_REASON = 'ticket_already_sent';
export const TICKET_EMAIL_SEND_IN_PROGRESS_REASON = 'ticket_email_send_in_progress';
export const TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON = 'gmail_hourly_limit_reached';
export const TICKET_EMAIL_DAILY_LIMIT_REACHED_REASON = 'gmail_daily_limit_reached';
export const TICKET_EMAIL_INVALID_RECIPIENT_REASON = 'invalid_attendee_email_address';

const TICKET_EMAIL_SEND_CLAIM_LEASE_MINUTES = 15;
const DEFAULT_TICKET_EMAIL_HOURLY_LIMIT = 20;

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

export async function renderTicketQrDataUrl(bookingRecord) {
  return QRCode.toDataURL(buildTicketQrCodeUrl(bookingRecord));
}

function escapeHtmlTextForTicketEmail(htmlTextValue) {
  return String(htmlTextValue)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildTicketEmailSubject(bookingRecord) {
  return `Your ${EVENT_TITLE} ticket (EVT-${bookingRecord.ref})`;
}

export function resolveTicketSenderAddress() {
  return resolveOutboundEmailSenderIdentity().address;
}

export function buildTicketEmailHtml(bookingRecord) {
  const eventDetails = getEventDetails();
  const attendeeName = escapeHtmlTextForTicketEmail(bookingRecord.full_name);
  const eventTitle = escapeHtmlTextForTicketEmail(eventDetails.eventTitle);
  const eventDate = escapeHtmlTextForTicketEmail(eventDetails.eventDate);
  const eventLocation = escapeHtmlTextForTicketEmail(eventDetails.eventLocation);
  const ticketCode = escapeHtmlTextForTicketEmail(`EVT-${bookingRecord.ref}`);
  const brandName = escapeHtmlTextForTicketEmail(PLATFORM_BRAND_NAME);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your ticket for ${eventTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#E9E2D5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E9E2D5;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#F2EDE3;border:1px solid #CAC6BD;">
          <tr>
            <td style="background-color:#14120E;padding:26px 30px;border-bottom:3px solid #A34A25;">
              <div style="font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:3px;color:#C9703F;">${brandName.toUpperCase()}</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.2;color:#F2EDE3;margin-top:14px;">Your ticket is ready</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 30px 0 30px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#14120E;">Hi ${attendeeName},</p>
              <p style="margin:12px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#615A4D;">Your booking is confirmed. Your ticket is attached to this email as a PNG image. Show it on your phone at the entrance.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 30px 0 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1px;color:#615A4D;width:38%;">EVENT</td>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#14120E;">${eventTitle}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1px;color:#615A4D;">DATE</td>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#14120E;">${eventDate}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1px;color:#615A4D;">VENUE</td>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#14120E;">${eventLocation}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:1px;color:#615A4D;">TICKET CODE</td>
                  <td style="padding:10px 0;border-bottom:1px solid #CAC6BD;font-family:'Courier New',Courier,monospace;font-size:13px;color:#14120E;">${ticketCode}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 30px 30px 30px;">
              <div style="border-top:1px dashed #A34A25;padding-top:16px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#615A4D;">
                Keep this email. If you cannot open the attachment, download the PDF from the booking lookup using reference ${escapeHtmlTextForTicketEmail(bookingRecord.ref)}.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildTicketEmailText(bookingRecord) {
  const eventDetails = getEventDetails();
  const ticketCode = `EVT-${bookingRecord.ref}`;

  return [
    `Hi ${bookingRecord.full_name},`,
    '',
    `Your booking for ${eventDetails.eventTitle} is confirmed.`,
    `Date: ${eventDetails.eventDate}`,
    `Venue: ${eventDetails.eventLocation}`,
    `Ticket code: ${ticketCode}`,
    '',
    `Your ticket is attached as ticket-${bookingRecord.ref}.png. Show it on your phone at the entrance.`,
    '',
    `You can also download the PDF from the booking lookup using reference ${bookingRecord.ref}.`,
    '',
    PLATFORM_BRAND_NAME,
  ].join('\n');
}

export function buildTicketEmailAttachments(
  ticketPngBuffer,
  bookingRecord,
  receiptPdfArtifact = null
) {
  const attachments = [
    {
      filename: `ticket-${bookingRecord.ref}.png`,
      content: ticketPngBuffer,
      contentType: 'image/png',
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

// next/og is a Next.js package. Load it only when a ticket is actually being
// rendered so the Express process can still start when email is disabled.
async function generateTicketPngArtifactForBooking(bookingRecord) {
  const { renderTicketPngBufferForBooking, renderBookingCodeQrDataUrl } =
    await import('../../frontend/lib/ticketImageRenderer.mjs');

  const qrDataUrl = await renderBookingCodeQrDataUrl(bookingRecord);
  const ticketPngBuffer = await renderTicketPngBufferForBooking(bookingRecord, {
    qrDataUrl,
    eventTimeLabel: process.env.EVENT_TIME_LABEL?.trim() || '',
  });

  return { qrDataUrl, ticketPngBuffer };
}

export async function sendTicketEmailToAttendee(bookingRecord, options = {}) {
  const attendeeEmailAddress =
    validateAttendeeEmailAddressForTicketDelivery(bookingRecord);

  const { qrDataUrl, ticketPngBuffer } =
    options.ticketPngBuffer && options.qrDataUrl
      ? { qrDataUrl: options.qrDataUrl, ticketPngBuffer: options.ticketPngBuffer }
      : await generateTicketPngArtifactForBooking(bookingRecord);

  const senderIdentity = resolveOutboundEmailSenderIdentity();
  const outboundEmailMessage = {
    from: senderIdentity,
    to: attendeeEmailAddress,
    subject: buildTicketEmailSubject(bookingRecord),
    text: buildTicketEmailText(bookingRecord),
    html: buildTicketEmailHtml(bookingRecord),
    attachments: buildTicketEmailAttachments(
      ticketPngBuffer,
      bookingRecord,
      options.receiptPdfArtifact ?? null
    ),
  };

  const sendOutcome = options.transport
    ? {
        providerMessageId:
          (await options.transport.sendMail(outboundEmailMessage))?.messageId ?? null,
        duplicate: false,
      }
    : await sendOutboundEmailThroughConfiguredProvider(outboundEmailMessage, {
        deliveryMetadata: buildBookingEmailDeliveryMetadata(
          bookingRecord,
          EMAIL_DELIVERY_KIND_TICKET
        ),
      });

  return {
    qrDataUrl,
    ticketPngBuffer,
    ticketAttachmentFileName: `ticket-${bookingRecord.ref}.png`,
    providerMessageId: sendOutcome.providerMessageId,
    deliveryWasDuplicate: sendOutcome.duplicate === true,
  };
}

// The claim is the single atomic gate. Two confirmations may both reach this
// function, but only the one whose UPDATE finds a free claim (or an expired
// claim) gets a row back. The booking's ticket_sent_at is checked in the same
// statement, so an already-delivered ticket can never be claimed again.
export async function claimTicketEmailSendForBooking(bookingRecord) {
  const ticketQrCodeUrl = buildTicketQrCodeUrl(bookingRecord);

  await pool.query(
    `INSERT INTO ticket_deliveries (booking_id, qr_payload)
     VALUES ($1, $2)
     ON CONFLICT (booking_id) DO NOTHING`,
    [bookingRecord.id, ticketQrCodeUrl]
  );

  const claimResult = await pool.query(
    `UPDATE ticket_deliveries AS ticket_delivery
        SET send_claimed_at = now(),
            attempt_count = ticket_delivery.attempt_count + 1,
            last_error = NULL,
            updated_at = now()
      WHERE ticket_delivery.booking_id = $1
        AND ticket_delivery.status IN ('pending', 'failed')
        AND (
          ticket_delivery.send_claimed_at IS NULL
          OR ticket_delivery.send_claimed_at < now() - ($2 * INTERVAL '1 minute')
        )
        AND EXISTS (
          SELECT 1
            FROM bookings AS booking_record
           WHERE booking_record.id = ticket_delivery.booking_id
             AND booking_record.status = 'confirmed'
             AND booking_record.ticket_sent_at IS NULL
        )
      RETURNING ticket_delivery.*`,
    [bookingRecord.id, TICKET_EMAIL_SEND_CLAIM_LEASE_MINUTES]
  );

  return claimResult.rows[0] ?? null;
}

async function markTicketEmailDeliveredForBooking(bookingRecord, deliveryRecord) {
  const databaseClient = await pool.connect();

  try {
    await databaseClient.query('BEGIN');

    await databaseClient.query(
      `UPDATE bookings
          SET ticket_sent_at = now(), updated_at = now()
        WHERE id = $1 AND ticket_sent_at IS NULL`,
      [bookingRecord.id]
    );

    await databaseClient.query(
      `UPDATE ticket_deliveries
          SET status = 'sent',
              sent_at = now(),
              send_claimed_at = NULL,
              last_error = NULL,
              updated_at = now()
        WHERE id = $1`,
      [deliveryRecord.id]
    );

    await databaseClient.query('COMMIT');
  } catch (error) {
    await databaseClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    databaseClient.release();
  }
}

async function markTicketEmailSendFailedForBooking(deliveryRecordId, failureReason) {
  await pool.query(
    `UPDATE ticket_deliveries
        SET status = 'failed',
            send_claimed_at = NULL,
            last_error = $1,
            updated_at = now()
      WHERE id = $2`,
    [failureReason, deliveryRecordId]
  );
}

async function recordTicketEmailSendBlockedForBooking(bookingId, blockedReason) {
  await pool.query(
    `INSERT INTO ticket_deliveries (booking_id, status, last_error)
     VALUES ($1, 'failed', $2)
     ON CONFLICT (booking_id) DO UPDATE
       SET status = 'failed',
           send_claimed_at = NULL,
           last_error = EXCLUDED.last_error,
           updated_at = now()
     WHERE ticket_deliveries.status <> 'sent'`,
    [bookingId, blockedReason]
  );
}

function resolveConfiguredTicketEmailLimit(environmentValue, defaultLimit) {
  if (environmentValue === undefined || environmentValue === '') {
    return defaultLimit;
  }

  const parsedLimit = Number(environmentValue);
  return Number.isFinite(parsedLimit) && parsedLimit >= 0
    ? Math.floor(parsedLimit)
    : defaultLimit;
}

export function resolveTicketEmailHourlyLimit() {
  return resolveConfiguredTicketEmailLimit(
    process.env.TICKET_EMAIL_HOURLY_LIMIT,
    DEFAULT_TICKET_EMAIL_HOURLY_LIMIT
  );
}

export function resolveTicketEmailDailyLimit() {
  // A consumer Google account can send about 100 recipients per day from Apps
  // Script, so the local guard stops at 90 and leaves headroom for a manual
  // resend. Gmail SMTP allows roughly 500.
  const defaultDailyLimit =
    resolveEmailTransportProviderName() === EMAIL_PROVIDER_APPS_SCRIPT ? 90 : 500;

  return resolveConfiguredTicketEmailLimit(
    process.env.TICKET_EMAIL_DAILY_LIMIT,
    defaultDailyLimit
  );
}

// Gmail's free tier is about 20 messages per hour and 500 recipients per day.
// The count reads the ticket delivery ledger, which has one row per booking, so
// one booking counts as one recipient. Set a limit to 0 to disable that guard.
export async function checkTicketEmailSendQuota() {
  const hourlyLimit = resolveTicketEmailHourlyLimit();
  const dailyLimit = resolveTicketEmailDailyLimit();

  if (hourlyLimit === 0 && dailyLimit === 0) {
    return { allowed: true, hourlyLimit, dailyLimit };
  }

  const quotaResult = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE sent_at >= now() - INTERVAL '1 hour'
       )::int AS hourly_sent_count,
       COUNT(*) FILTER (
         WHERE sent_at >= now() - INTERVAL '24 hours'
       )::int AS daily_sent_count
     FROM ticket_deliveries
     WHERE status = 'sent' AND sent_at IS NOT NULL`
  );

  const { hourly_sent_count: hourlySentCount, daily_sent_count: dailySentCount } =
    quotaResult.rows[0];

  if (dailyLimit > 0 && dailySentCount >= dailyLimit) {
    return {
      allowed: false,
      reason: TICKET_EMAIL_DAILY_LIMIT_REACHED_REASON,
      hourlyLimit,
      dailyLimit,
      hourlySentCount,
      dailySentCount,
    };
  }

  if (hourlyLimit > 0 && hourlySentCount >= hourlyLimit) {
    return {
      allowed: false,
      reason: TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON,
      hourlyLimit,
      dailyLimit,
      hourlySentCount,
      dailySentCount,
    };
  }

  return {
    allowed: true,
    hourlyLimit,
    dailyLimit,
    hourlySentCount,
    dailySentCount,
  };
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

async function deliverTicketEmailForConfirmedBooking(
  bookingRecord,
  sendTicketEmail,
  deliveryOptions
) {
  if (bookingRecord.ticket_sent_at) {
    return {
      delivered: false,
      skipped: true,
      reason: TICKET_EMAIL_ALREADY_SENT_REASON,
      bookingId: bookingRecord.id,
    };
  }

  let attendeeEmailAddress;
  try {
    attendeeEmailAddress = validateAttendeeEmailAddressForTicketDelivery(bookingRecord);
  } catch (error) {
    if (error instanceof InvalidAttendeeEmailAddressError) {
      logError('ticket_email_invalid_recipient', {
        bookingId: bookingRecord.id,
        reason: TICKET_EMAIL_INVALID_RECIPIENT_REASON,
      });
      return {
        delivered: false,
        skipped: true,
        reason: TICKET_EMAIL_INVALID_RECIPIENT_REASON,
        bookingId: bookingRecord.id,
      };
    }
    throw error;
  }

  const quotaCheck = await checkTicketEmailSendQuota();
  if (!quotaCheck.allowed) {
    await recordTicketEmailSendBlockedForBooking(bookingRecord.id, quotaCheck.reason);
    logWarning('ticket_email_rate_limited', {
      bookingId: bookingRecord.id,
      reason: quotaCheck.reason,
      hourlySentCount: quotaCheck.hourlySentCount,
      dailySentCount: quotaCheck.dailySentCount,
      hourlyLimit: quotaCheck.hourlyLimit,
      dailyLimit: quotaCheck.dailyLimit,
    });
    return {
      delivered: false,
      skipped: true,
      reason: quotaCheck.reason,
      bookingId: bookingRecord.id,
    };
  }

  const deliveryRecord = await claimTicketEmailSendForBooking(bookingRecord);
  if (!deliveryRecord) {
    const refreshedBookingRecord = await fetchBookingRecordById(bookingRecord.id);

    return {
      delivered: false,
      skipped: true,
      reason: refreshedBookingRecord?.ticket_sent_at
        ? TICKET_EMAIL_ALREADY_SENT_REASON
        : TICKET_EMAIL_SEND_IN_PROGRESS_REASON,
      bookingId: bookingRecord.id,
    };
  }

  const receiptRecord = deliveryOptions.receiptRecord ?? null;
  const deliverReceiptEmail = deliveryOptions.deliverReceiptEmail ?? null;

  try {
    const builtReceiptPdf = receiptRecord
      ? await buildReceiptPdfAttachmentForTicketEmail(bookingRecord.id, receiptRecord)
      : null;

    const sendResult = await sendTicketEmail(bookingRecord, {
      receiptPdfArtifact: builtReceiptPdf,
      paymentSummary: deliveryOptions.paymentSummary ?? null,
    });
    await markTicketEmailDeliveredForBooking(bookingRecord, deliveryRecord);

    const receiptDelivery =
      builtReceiptPdf && deliverReceiptEmail
        ? await deliverPaymentReceiptAfterTicketDelivery(
            bookingRecord.id,
            receiptRecord,
            builtReceiptPdf,
            deliverReceiptEmail
          )
        : null;

    return {
      delivered: true,
      deliveryId: deliveryRecord.id,
      bookingId: bookingRecord.id,
      recipientEmailAddress: attendeeEmailAddress,
      ticketAttachmentFileName: sendResult?.ticketAttachmentFileName ?? null,
      providerMessageId: sendResult?.providerMessageId ?? null,
      deliveryWasDuplicate: sendResult?.deliveryWasDuplicate === true,
      receipt: receiptDelivery,
    };
  } catch (error) {
    const providerFailureReason =
      error.message || 'Unknown email delivery error';
    const failureReason = error.remoteErrorMessage
      ? `${providerFailureReason}: ${error.remoteErrorMessage}`
      : providerFailureReason;

    await markTicketEmailSendFailedForBooking(deliveryRecord.id, failureReason);
    logError('ticket_email_delivery_failed', {
      bookingId: bookingRecord.id,
      deliveryId: deliveryRecord.id,
      reason: failureReason,
    });

    return {
      delivered: false,
      deliveryId: deliveryRecord.id,
      bookingId: bookingRecord.id,
      reason: failureReason,
    };
  }
}

export async function deliverTicketForConfirmedBooking(
  bookingId,
  sendTicketEmail = sendTicketEmailToAttendee,
  deliveryOptions = {}
) {
  try {
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

    return await deliverTicketEmailForConfirmedBooking(
      bookingRecord,
      sendTicketEmail,
      deliveryOptions
    );
  } catch (error) {
    // A mail or database failure must never undo a confirmed booking.
    logError('ticket_email_delivery_unexpected_failure', {
      bookingId,
      reason: error.message || 'Unknown ticket delivery error',
    });
    return {
      delivered: false,
      bookingId,
      reason: error.message || 'Unknown ticket delivery error',
    };
  }
}

// The delivery ledger stores the raw provider error so an operator can diagnose
// it. The API adds this short explanation for the failures that have a known
// fix, without ever including the Apps Script shared secret.
export function buildTicketEmailDeliveryFailureMessage(failureReason) {
  const failureReasonText = String(failureReason ?? '');

  if (failureReasonText.includes('APPS_SCRIPT_DEV_URL_NOT_ALLOWED')) {
    return 'The Apps Script URL is the /dev test URL, which requires a Google sign-in. Use the /exec URL from Deploy → Manage deployments.';
  }

  if (failureReasonText.includes('APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED')) {
    return 'Apps Script email delivery is not configured. Set APPS_SCRIPT_TICKET_WEBHOOK_URL and APPS_SCRIPT_SHARED_SECRET on the server.';
  }

  if (
    failureReasonText.includes('APPS_SCRIPT_HTTP_401') ||
    failureReasonText.includes('APPS_SCRIPT_HTTP_403')
  ) {
    return 'Google requires a sign-in for the Apps Script deployment. Use the /exec URL and set Who has access to Anyone (anonymous), then retry.';
  }

  if (failureReasonText.includes('APPS_SCRIPT_HTTP_404')) {
    return 'The Apps Script deployment URL was not found. Copy the current /exec URL from Deploy → Manage deployments and update APPS_SCRIPT_TICKET_WEBHOOK_URL.';
  }

  if (failureReasonText.includes('APPS_SCRIPT_RESPONSE_NOT_JSON')) {
    return 'Apps Script did not return JSON. Use the /exec deployment URL and set Who has access to Anyone (anonymous).';
  }

  if (failureReasonText.includes('APPS_SCRIPT_REQUEST_TIMED_OUT')) {
    return 'Apps Script did not answer in time. Retry; if it keeps happening, raise APPS_SCRIPT_REQUEST_TIMEOUT_MS.';
  }

  if (failureReasonText.includes('APPS_SCRIPT_ATTACHMENT_TOO_LARGE')) {
    return 'The ticket attachment is larger than the Apps Script limit. Reduce the attachment size and retry.';
  }

  if (failureReasonText.includes('gmail_quota_check_failed')) {
    return 'Gmail could not read the sending quota. Run sendTestEmailToScriptOwner or diagnoseTicketEmailDelivery in the Apps Script editor and approve the Gmail permission. If it still fails, redeploy the current Code.gs so the send is attempted and the real Gmail error is returned.';
  }

  if (failureReasonText.includes('mail_send_failed')) {
    const mailFailureDetail = failureReasonText
      .split('mail_send_failed')
      .slice(1)
      .join('mail_send_failed')
      .replace(/^:\s*/, '')
      .trim();

    return mailFailureDetail
      ? `Google's mail service rejected the message: ${mailFailureDetail}. Check the Ticket deliveries sheet Error column and Apps Script Executions.`
      : "Google's mail service rejected the message. Check the Ticket deliveries sheet Error column and Apps Script Executions for the exact reason.";
  }

  if (failureReasonText) {
    return `Ticket email delivery failed: ${failureReasonText}`;
  }

  return 'Ticket email delivery failed';
}

export async function redeliverFailedTicketEmail(
  bookingId,
  sendTicketEmail = sendTicketEmailToAttendee
) {
  try {
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

    if (bookingRecord.ticket_sent_at) {
      return {
        delivered: false,
        skipped: true,
        reason: TICKET_EMAIL_ALREADY_SENT_REASON,
        bookingId: bookingRecord.id,
      };
    }

    return await deliverTicketEmailForConfirmedBooking(
      bookingRecord,
      sendTicketEmail,
      {}
    );
  } catch (error) {
    logError('ticket_email_redelivery_failed', {
      bookingId,
      reason: error.message || 'Unknown ticket redelivery error',
    });
    return {
      delivered: false,
      bookingId,
      reason: error.message || 'Unknown ticket redelivery error',
    };
  }
}

export async function fetchFailedTicketDeliveryRecordsBelowMaxAttempts(maxAttempts) {
  const result = await pool.query(
    `SELECT td.*
       FROM ticket_deliveries td
       JOIN bookings b ON b.id = td.booking_id
      WHERE td.status = 'failed'
        AND b.status = 'confirmed'
        AND b.ticket_sent_at IS NULL
        AND td.attempt_count < $1
      ORDER BY td.updated_at ASC`,
    [maxAttempts]
  );
  return result.rows;
}

export function resolveTicketDeliveryMaxAttempts() {
  return Number(process.env.TICKET_DELIVERY_MAX_ATTEMPTS || 5);
}
