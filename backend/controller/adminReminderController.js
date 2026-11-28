import {
  REMINDER_AUDIENCE_CONFIRMED,
  REMINDER_AUDIENCE_UNPAID,
  sendAttendeeRemindersToEligibleAudience,
} from '../services/attendeeReminderService.js';

async function sendManualAttendeeReminderBatchEndpoint(req, res) {
  const reminderAudience = req.body?.audience;
  if (![REMINDER_AUDIENCE_CONFIRMED, REMINDER_AUDIENCE_UNPAID].includes(reminderAudience)) {
    return res.status(400).json({
      message: 'Audience must be either confirmed or unpaid',
      error: 'INVALID_REMINDER_AUDIENCE',
    });
  }

  try {
    const reminderSummary = await sendAttendeeRemindersToEligibleAudience(reminderAudience);
    return res.status(200).json({ reminderSummary });
  } catch (error) {
    console.error('Error sending attendee reminder emails', error);
    return res.status(500).json({ message: 'Error sending attendee reminder emails' });
  }
}

export default {
  sendManualAttendeeReminderBatchEndpoint,
};
