// The instructions page, the confirmation page and the polling hook all need
// to know when a payment will no longer change on its own. One list stops the
// three from disagreeing about when to stop polling.

export const TERMINAL_PAYMENT_STATUSES = Object.freeze([
  'confirmed',
  'failed',
  'expired',
]);

export function isPaymentStatusTerminal(paymentStatus) {
  return TERMINAL_PAYMENT_STATUSES.includes(paymentStatus);
}
