import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import {
  REMINDER_AUDIENCE_CONFIRMED,
  REMINDER_AUDIENCE_UNPAID,
  buildAttendeeReminderEmailContent,
  sendAttendeeRemindersToEligibleAudience,
} from '../services/attendeeReminderService.js';
import {
  confirmBookingSeatWithinCapacity,
  createBookingRecordWithActiveSeatHold,
} from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

async function resetReminderTestDatabase() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetReminderTestDatabase);

async function createReminderBooking(emailAddress, fullName) {
  return createBookingRecordWithActiveSeatHold({
    full_name: fullName,
    email: emailAddress,
    phone_number: '+255712345678',
  });
}

test('manual confirmed reminders email only confirmed attendees once', async () => {
  const confirmedBooking = await createReminderBooking(
    'confirmed-reminder@example.com',
    'Confirmed Attendee'
  );
  await confirmBookingSeatWithinCapacity(confirmedBooking.id);
  await createReminderBooking('pending-reminder@example.com', 'Pending Attendee');

  const recipients = [];
  const deliveryOptions = {
    sendReminderEmail: async (bookingRecord, reminderAudience) => {
      recipients.push({ email: bookingRecord.email, reminderAudience });
    },
  };

  const firstSummary = await sendAttendeeRemindersToEligibleAudience(
    REMINDER_AUDIENCE_CONFIRMED,
    deliveryOptions
  );
  const secondSummary = await sendAttendeeRemindersToEligibleAudience(
    REMINDER_AUDIENCE_CONFIRMED,
    deliveryOptions
  );

  assert.equal(firstSummary.sentCount, 1);
  assert.equal(firstSummary.failedCount, 0);
  assert.equal(secondSummary.eligibleCount, 0);
  assert.deepEqual(recipients, [
    {
      email: 'confirmed-reminder@example.com',
      reminderAudience: REMINDER_AUDIENCE_CONFIRMED,
    },
  ]);

  const deliveryResult = await pool.query(
    `SELECT status, attempt_count, sent_at FROM reminder_deliveries
      WHERE booking_id = $1 AND reminder_type = 'confirmed'`,
    [confirmedBooking.id]
  );
  assert.equal(deliveryResult.rows[0].status, 'sent');
  assert.equal(deliveryResult.rows[0].attempt_count, 1);
  assert.ok(deliveryResult.rows[0].sent_at);
});

test('automatic payment reminders select old unpaid bookings and retry failures without duplicating successes', async () => {
  const oldUnpaidBooking = await createReminderBooking(
    'automatic-unpaid@example.com',
    'Automatic Unpaid'
  );
  await createPendingPaymentRecordForBooking(oldUnpaidBooking.id, 'lipanamba');
  await pool.query(
    `UPDATE bookings SET created_at = now() - INTERVAL '2 hours' WHERE id = $1`,
    [oldUnpaidBooking.id]
  );

  const recentUnpaidBooking = await createReminderBooking(
    'recent-unpaid@example.com',
    'Recent Unpaid'
  );
  await createPendingPaymentRecordForBooking(recentUnpaidBooking.id, 'lipanamba');

  const firstSummary = await sendAttendeeRemindersToEligibleAudience(
    REMINDER_AUDIENCE_UNPAID,
    {
      automaticOnly: true,
      sendReminderEmail: async () => {
        throw new Error('SMTP unavailable');
      },
    }
  );
  assert.equal(firstSummary.sentCount, 0);
  assert.equal(firstSummary.failedCount, 1);

  const secondSummary = await sendAttendeeRemindersToEligibleAudience(
    REMINDER_AUDIENCE_UNPAID,
    {
      automaticOnly: true,
      sendReminderEmail: async () => {},
    }
  );
  const thirdSummary = await sendAttendeeRemindersToEligibleAudience(
    REMINDER_AUDIENCE_UNPAID,
    { automaticOnly: true, sendReminderEmail: async () => {} }
  );

  assert.equal(secondSummary.sentCount, 1);
  assert.equal(thirdSummary.eligibleCount, 0);

  const deliveryResult = await pool.query(
    `SELECT status, attempt_count, last_error FROM reminder_deliveries
      WHERE booking_id = $1 AND reminder_type = 'unpaid'`,
    [oldUnpaidBooking.id]
  );
  assert.equal(deliveryResult.rows[0].status, 'sent');
  assert.equal(deliveryResult.rows[0].attempt_count, 2);
  assert.equal(deliveryResult.rows[0].last_error, null);
});

test('reminder batches leave additional eligible recipients for the next run', async () => {
  await createReminderBooking('first-batch@example.com', 'First Batch');
  await createReminderBooking('second-batch@example.com', 'Second Batch');

  const summary = await sendAttendeeRemindersToEligibleAudience(
    REMINDER_AUDIENCE_UNPAID,
    { maximumBatchSize: 1, sendReminderEmail: async () => {} }
  );

  assert.equal(summary.eligibleCount, 2);
  assert.equal(summary.sentCount, 1);
  assert.equal(summary.remainingCount, 1);
});

test('payment reminder copy identifies the booking and payment action', () => {
  const emailContent = buildAttendeeReminderEmailContent(
    { full_name: 'Reminder Reader', ref: 'PAY123' },
    REMINDER_AUDIENCE_UNPAID
  );

  assert.match(emailContent.subject, /Complete your payment/);
  assert.match(emailContent.text, /PAY123/);
  assert.match(emailContent.text, /Complete your payment to secure your place/);
});
