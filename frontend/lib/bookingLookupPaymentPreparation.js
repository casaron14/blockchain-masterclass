// A lookup that already has a payment must resume that payment: its method
// cards are hidden on screen, so a missing selection must not block the
// redirect to the payment page.
export function resolveBookingLookupPaymentPreparationStep(
  lookupResult,
  selectedPaymentMethod
) {
  const existingPaymentPublicToken = lookupResult?.payment?.public_token;
  if (existingPaymentPublicToken) {
    return { existingPaymentPublicToken };
  }
  if (!selectedPaymentMethod) {
    return { requiresPaymentMethodSelection: true };
  }
  return { paymentMethodToCreatePayment: selectedPaymentMethod };
}
