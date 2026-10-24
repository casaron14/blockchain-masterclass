// Copy shown after the admin takes the single final booking step. The booking
// and payment are already confirmed at this point; only the ticket email can
// still be pending, so the wording has to say that instead of implying failure.
// A deployment with EMAIL_DELIVERY_ENABLED=false skips the email entirely and
// the attendee downloads the ticket from the booking lookup.
export function resolveBookingConfirmationMessage(confirmationResult) {
  const ticketDelivery = confirmationResult?.ticketDelivery;

  if (ticketDelivery?.skipped) {
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
