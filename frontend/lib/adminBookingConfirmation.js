// Copy shown after the admin takes the single final booking step. The booking
// and payment are already confirmed at this point; only the ticket email can
// still be pending, so the wording has to say that instead of implying failure.
export function resolveBookingConfirmationMessage(confirmationResult) {
  const isTicketDeliveryPending = Boolean(
    confirmationResult?.ticketDelivery &&
      confirmationResult.ticketDelivery.delivered === false
  );

  return {
    tone: isTicketDeliveryPending ? 'info' : 'success',
    message: isTicketDeliveryPending
      ? 'Booking confirmed, but the ticket email could not be sent yet.'
      : 'Booking confirmed, payment recorded and ticket emailed.',
  };
}
