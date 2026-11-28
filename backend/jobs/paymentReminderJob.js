import {
  REMINDER_AUDIENCE_UNPAID,
  sendAttendeeRemindersToEligibleAudience,
} from '../services/attendeeReminderService.js';

export async function runAutomaticPaymentReminderJob(options = {}) {
  return sendAttendeeRemindersToEligibleAudience(REMINDER_AUDIENCE_UNPAID, {
    ...options,
    automaticOnly: true,
  });
}
