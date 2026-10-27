// Copy shown after the admin takes the single final booking step. The booking
// and payment are already confirmed at this point; only the ticket email can
// still be pending, so the wording has to say that instead of implying failure.
// A deployment with EMAIL_DELIVERY_ENABLED=false skips the email entirely and
// the attendee downloads the ticket from the booking lookup.
export function resolveBookingConfirmationMessage(confirmationResult) {
  const ticketDelivery = confirmationResult?.ticketDelivery;

  if (ticketDelivery?.skipped) {
    if (ticketDelivery.reason === 'ticket_already_sent') {
      return {
        tone: 'success',
        message:
          'Booking confirmed. This attendee was already emailed a ticket, so no second email was sent.',
      };
    }

    if (
      ticketDelivery.reason === 'gmail_hourly_limit_reached' ||
      ticketDelivery.reason === 'gmail_daily_limit_reached'
    ) {
      return {
        tone: 'info',
        message:
          'Booking confirmed, but the Gmail sending limit has been reached. Use “Resend ticket email” later, or move to a transactional provider for higher volume.',
      };
    }

    if (ticketDelivery.reason === 'invalid_attendee_email_address') {
      return {
        tone: 'error',
        message:
          'Booking confirmed, but the attendee email address is not valid. Correct the email and use “Resend ticket email”.',
      };
    }

    return {
      tone: 'success',
      message:
        'Booking confirmed and payment recorded. The attendee can download the ticket from the booking lookup.',
    };
  }

  const isTicketDeliveryPending = Boolean(
    ticketDelivery && ticketDelivery.delivered === false
  );

  return {
    tone: isTicketDeliveryPending ? 'info' : 'success',
    message: isTicketDeliveryPending
      ? 'Booking confirmed, but the ticket email could not be sent yet.'
      : 'Booking confirmed, payment recorded and ticket emailed.',
  };
}
