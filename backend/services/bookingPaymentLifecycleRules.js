// Booking and payment statuses are database enums, but the allowed moves
// between them used to live only in prose and in per-caller WHERE clauses. This
// module is the single definition of those moves so a late webhook, an admin
// edit or a retried request cannot move a row backwards by accident.
//
// The same rules decide two things callers must not answer differently:
//   1. whether a status change is allowed at all;
//   2. whether a booking is cleared for ticket access.

export const BOOKING_STATUS_VALUES = Object.freeze([
  'pending',
  'confirmed',
  'cancelled',
  'expired',
]);

export const PAYMENT_STATUS_VALUES = Object.freeze([
  'initiating',
  'pending',
  'confirmed',
  'failed',
  'expired',
]);

// A confirmed seat is only given back deliberately: `confirmed` can move to
// `cancelled` (an admin revocation) but never back to `pending` or `expired`,
// because either would quietly release a seat that was paid for.
// `cancelled -> pending` exists because the admin screen revives a cancelled
// booking before confirming it.
export const BOOKING_STATUS_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['confirmed', 'cancelled', 'expired']),
  confirmed: Object.freeze(['cancelled']),
  cancelled: Object.freeze(['pending']),
  expired: Object.freeze(['pending', 'confirmed', 'cancelled']),
});

// `confirmed` is terminal. A payment that was confirmed can only stop being
// confirmed through a deliberate, recorded correction, which this app does not
// have; every automatic writer must leave it alone.
export const PAYMENT_STATUS_TRANSITIONS = Object.freeze({
  initiating: Object.freeze(['pending', 'confirmed', 'failed', 'expired']),
  pending: Object.freeze(['initiating', 'confirmed', 'failed', 'expired']),
  confirmed: Object.freeze([]),
  failed: Object.freeze(['initiating', 'pending', 'confirmed']),
  expired: Object.freeze(['initiating', 'pending', 'confirmed']),
});

function buildPreviousStatusMap(statusTransitionMap) {
  const previousStatusMap = {};

  for (const [currentStatus, allowedNextStatuses] of Object.entries(statusTransitionMap)) {
    for (const nextStatus of allowedNextStatuses) {
      if (!previousStatusMap[nextStatus]) {
        previousStatusMap[nextStatus] = [];
      }
      previousStatusMap[nextStatus].push(currentStatus);
    }
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(previousStatusMap).map(([nextStatus, previousStatuses]) => [
        nextStatus,
        Object.freeze(previousStatuses),
      ])
    )
  );
}

// Used as the `status = ANY(...)` guard in the payment UPDATE.
export const PAYMENT_STATUS_PREVIOUS_STATUSES = buildPreviousStatusMap(
  PAYMENT_STATUS_TRANSITIONS
);

export class BookingStatusTransitionError extends Error {
  constructor(currentBookingStatus, nextBookingStatus) {
    super(
      `Booking status cannot move from "${currentBookingStatus}" to "${nextBookingStatus}"`
    );
    this.name = 'BookingStatusTransitionError';
    this.code = 'BOOKING_STATUS_TRANSITION_NOT_ALLOWED';
    this.currentBookingStatus = currentBookingStatus;
    this.nextBookingStatus = nextBookingStatus;
  }
}

export class PaymentStatusTransitionError extends Error {
  constructor(currentPaymentStatus, nextPaymentStatus) {
    super(
      `Payment status cannot move from "${currentPaymentStatus}" to "${nextPaymentStatus}"`
    );
    this.name = 'PaymentStatusTransitionError';
    this.code = 'PAYMENT_STATUS_TRANSITION_NOT_ALLOWED';
    this.currentPaymentStatus = currentPaymentStatus;
    this.nextPaymentStatus = nextPaymentStatus;
  }
}

export function isBookingStatusTransitionAllowed(
  currentBookingStatus,
  nextBookingStatus
) {
  return Boolean(
    BOOKING_STATUS_TRANSITIONS[currentBookingStatus]?.includes(nextBookingStatus)
  );
}

export function assertBookingStatusTransitionAllowed(
  currentBookingStatus,
  nextBookingStatus
) {
  if (!isBookingStatusTransitionAllowed(currentBookingStatus, nextBookingStatus)) {
    throw new BookingStatusTransitionError(currentBookingStatus, nextBookingStatus);
  }
  return nextBookingStatus;
}

export function isPaymentStatusTransitionAllowed(
  currentPaymentStatus,
  nextPaymentStatus
) {
  return Boolean(
    PAYMENT_STATUS_TRANSITIONS[currentPaymentStatus]?.includes(nextPaymentStatus)
  );
}

export function assertPaymentStatusTransitionAllowed(
  currentPaymentStatus,
  nextPaymentStatus
) {
  if (!isPaymentStatusTransitionAllowed(currentPaymentStatus, nextPaymentStatus)) {
    throw new PaymentStatusTransitionError(
      currentPaymentStatus,
      nextPaymentStatus
    );
  }
  return nextPaymentStatus;
}

// These are the statuses after which nothing more will change on its own, so
// the attendee page can stop polling. `expired` stays in the list for legacy
// rows even though no writer produces it any more.
export function isPaymentStatusTerminal(paymentStatus) {
  return ['confirmed', 'failed', 'expired'].includes(paymentStatus);
}

// The attendee may see the ticket only when the seat and the money agree. A
// booking with no payment row at all is an admin-created guest booking, which
// has no money to wait for.
export function canAttendeeAccessTicketForBooking({
  bookingStatus,
  paymentStatus,
}) {
  if (bookingStatus !== 'confirmed') {
    return false;
  }
  return paymentStatus === null || paymentStatus === undefined || paymentStatus === 'confirmed';
}
