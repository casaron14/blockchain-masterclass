import pool from '../config/db.js';

import {
  buildBookingEmailDeliveryMetadata,
  EMAIL_DELIVERY_KIND_REMINDER,
} from './bookingEmailDeliveryMetadataService.js';
import { validateAttendeeEmailAddressForTicketDelivery } from './attendeeEmailAddressValidator.js';
import {
  resolveOutboundEmailSenderIdentity,
  sendOutboundEmailThroughConfiguredProvider,
} from './emailTransportService.js';
import {
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  EVENT_TITLE,
  EVENT_VENUE_NAME,
  EVENT_WEBSITE_ADDRESS,
  SUPPORT_PHONE_NUMBER,
} from './eventConfigService.js';
import { isTicketEmailDeliveryEnabled } from './ticketDeliveryService.js';

export const REMINDER_AUDIENCE_CONFIRMED = 'confirmed';
export const REMINDER_AUDIENCE_UNPAID = 'unpaid';
export const REMINDER_DELIVERY_DISABLED_REASON = 'email_delivery_disabled';

const DEFAULT_REMINDER_BATCH_SIZE = 20;

export function resolveReminderBatchSize() {
  const configuredBatchSize = Number(process.env.REMINDER_EMAIL_BATCH_SIZE);
  return Number.isFinite(configuredBatchSize) && configuredBatchSize > 0
    ? Math.floor(configuredBatchSize)
    : DEFAULT_REMINDER_BATCH_SIZE;
}

function escapeHtmlTextForReminderEmail(htmlTextValue) {
  return String(htmlTextValue)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildAttendeeReminderEmailContent(bookingRecord, reminderAudience) {
  const attendeeName = bookingRecord.full_name;
  const eventVenue = `${EVENT_VENUE_NAME}, ${EVENT_LOCATION}`;

  if (reminderAudience === REMINDER_AUDIENCE_CONFIRMED) {
    return {
      subject: `Reminder: ${EVENT_TITLE} (${bookingRecord.ref})`,
      text: [
        `Hi ${attendeeName},`,
        '',
        `This is a reminder that your place at ${EVENT_TITLE} is confirmed.`,
        `Date: ${EVENT_DATE_LABEL}`,
        `Venue: ${eventVenue}`,
        `Booking reference: ${bookingRecord.ref}`,
        '',
        `Keep your booking reference and ticket ready for check-in. If you need help, call ${SUPPORT_PHONE_NUMBER}.`,
        '',
        EVENT_WEBSITE_ADDRESS,
      ].join('\n'),
    };
  }

  return {
    subject: `Complete your payment for ${EVENT_TITLE} (${bookingRecord.ref})`,
    text: [
      `Hi ${attendeeName},`,
      '',
      `Your booking for ${EVENT_TITLE} is still awaiting payment. Complete your payment to secure your place.`,
      `Date: ${EVENT_DATE_LABEL}`,
      `Venue: ${eventVenue}`,
      `Booking reference: ${bookingRecord.ref}`,
      '',
      `Visit ${EVENT_WEBSITE_ADDRESS} and use your booking reference to return to your booking. If you have already paid, please contact us on ${SUPPORT_PHONE_NUMBER}.`,
    ].join('\n'),
  };
}

export async function sendAttendeeReminderEmail(
  bookingRecord,
  reminderAudience,
  deliveryAttemptCount,
  options = {}
) {
  const attendeeEmailAddress = validateAttendeeEmailAddressForTicketDelivery(bookingRecord);
  const emailContent = buildAttendeeReminderEmailContent(bookingRecord, reminderAudience);
  const escapedEmailText = escapeHtmlTextForReminderEmail(emailContent.text)
    .split('\n')
    .join('<br />');

  const outboundEmailMessage = {
    from: resolveOutboundEmailSenderIdentity(),
    to: attendeeEmailAddress,
    subject: emailContent.subject,
    text: emailContent.text,
    html: `<p>${escapedEmailText}</p>`,
  };

  return sendOutboundEmailThroughConfiguredProvider(outboundEmailMessage, {
    transport: options.transport,
    deliveryMetadata: buildBookingEmailDeliveryMetadata(
      bookingRecord,
      EMAIL_DELIVERY_KIND_REMINDER,
      { deliveryKeySuffix: `${reminderAudience}-${deliveryAttemptCount}` }
    ),
  });
}

function buildEligibleReminderRecipientQuery(reminderAudience, automaticOnly) {
  const audienceCondition = reminderAudience === REMINDER_AUDIENCE_CONFIRMED
    ? `booking_record.status = 'confirmed'`
    : `booking_record.status IN ('pending', 'expired')
       AND NOT EXISTS (
         SELECT 1 FROM payments AS payment_record
          WHERE payment_record.booking_id = booking_record.id
            AND payment_record.status = 'confirmed'
       )`;
  const automaticAgeCondition = automaticOnly
    ? `AND booking_record.created_at <= now() - INTERVAL '1 hour'`
    : '';

  return `SELECT booking_record.*
            FROM bookings AS booking_record
           WHERE ${audienceCondition}
             ${automaticAgeCondition}
             AND NOT EXISTS (
               SELECT 1 FROM reminder_deliveries AS reminder_delivery
                WHERE reminder_delivery.booking_id = booking_record.id
                  AND reminder_delivery.reminder_type = $1
                  AND reminder_delivery.sent_at IS NOT NULL
             )
           ORDER BY booking_record.created_at ASC`;
}

async function claimReminderEmailDelivery(bookingId, reminderAudience) {
  const claimResult = await pool.query(
    `INSERT INTO reminder_deliveries (
       booking_id, reminder_type, attempt_count, send_claimed_at
     ) VALUES ($1, $2, 1, now())
     ON CONFLICT (booking_id, reminder_type) DO UPDATE
       SET attempt_count = reminder_deliveries.attempt_count + 1,
           send_claimed_at = now(),
           last_error = NULL,
           updated_at = now()
       WHERE reminder_deliveries.send_claimed_at IS NULL
          OR reminder_deliveries.send_claimed_at < now() - INTERVAL '15 minutes'
     RETURNING *`,
    [bookingId, reminderAudience]
  );
  return claimResult.rows[0] ?? null;
}

async function markReminderEmailDelivered(reminderDeliveryId) {
  await pool.query(
    `UPDATE reminder_deliveries
        SET status = 'sent', sent_at = now(), send_claimed_at = NULL,
            last_error = NULL, updated_at = now()
      WHERE id = $1`,
    [reminderDeliveryId]
  );
}

async function markReminderEmailDeliveryFailed(reminderDeliveryId, failureReason) {
  await pool.query(
    `UPDATE reminder_deliveries
        SET status = 'failed', send_claimed_at = NULL,
            last_error = $2, updated_at = now()
      WHERE id = $1`,
    [reminderDeliveryId, failureReason]
  );
}

export async function sendAttendeeRemindersToEligibleAudience(
  reminderAudience,
  options = {}
) {
  if (![REMINDER_AUDIENCE_CONFIRMED, REMINDER_AUDIENCE_UNPAID].includes(reminderAudience)) {
    throw new Error(`Unsupported reminder audience: ${reminderAudience}`);
  }

  const automaticOnly = options.automaticOnly === true;
  if (automaticOnly && reminderAudience !== REMINDER_AUDIENCE_UNPAID) {
    throw new Error('Only unpaid attendee reminders can run automatically');
  }

  if (!isTicketEmailDeliveryEnabled()) {
    return {
      audience: reminderAudience,
      eligibleCount: 0,
      sentCount: 0,
      failedCount: 0,
      remainingCount: 0,
      skipped: true,
      reason: REMINDER_DELIVERY_DISABLED_REASON,
    };
  }

  const eligibleRecipientResult = await pool.query(
    buildEligibleReminderRecipientQuery(reminderAudience, automaticOnly),
    [reminderAudience]
  );
  const maximumBatchSize = options.maximumBatchSize ?? resolveReminderBatchSize();
  const reminderRecipients = eligibleRecipientResult.rows.slice(0, maximumBatchSize);
  const sendReminderEmail = options.sendReminderEmail ?? sendAttendeeReminderEmail;
  const deliveryOutcomes = [];

  for (const bookingRecord of reminderRecipients) {
    const reminderDelivery = await claimReminderEmailDelivery(
      bookingRecord.id,
      reminderAudience
    );
    if (!reminderDelivery) {
      continue;
    }

    try {
      await sendReminderEmail(
        bookingRecord,
        reminderAudience,
        reminderDelivery.attempt_count
      );
      await markReminderEmailDelivered(reminderDelivery.id);
      deliveryOutcomes.push({ bookingId: bookingRecord.id, delivered: true });
    } catch (error) {
      const failureReason = error.message || 'Unknown reminder email delivery error';
      await markReminderEmailDeliveryFailed(reminderDelivery.id, failureReason);
      deliveryOutcomes.push({
        bookingId: bookingRecord.id,
        delivered: false,
        reason: failureReason,
      });
    }
  }

  const sentCount = deliveryOutcomes.filter((outcome) => outcome.delivered).length;
  return {
    audience: reminderAudience,
    eligibleCount: eligibleRecipientResult.rows.length,
    sentCount,
    failedCount: deliveryOutcomes.length - sentCount,
    remainingCount: eligibleRecipientResult.rows.length - sentCount,
    skipped: false,
    deliveries: deliveryOutcomes,
  };
}
