import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKING_STATUS_TRANSITIONS,
  PAYMENT_STATUS_PREVIOUS_STATUSES,
  PAYMENT_STATUS_TRANSITIONS,
  canAttendeeAccessTicketForBooking,
  isBookingStatusTransitionAllowed,
  isPaymentStatusTerminal,
  isPaymentStatusTransitionAllowed,
} from '../services/bookingPaymentLifecycleRules.js';

test('a confirmed booking can only be cancelled, never returned to a hold', () => {
  assert.equal(isBookingStatusTransitionAllowed('pending', 'confirmed'), true);
  assert.equal(isBookingStatusTransitionAllowed('confirmed', 'cancelled'), true);
  assert.equal(isBookingStatusTransitionAllowed('confirmed', 'pending'), false);
  assert.equal(isBookingStatusTransitionAllowed('confirmed', 'expired'), false);
});

test('a cancelled booking is revived through pending', () => {
  assert.equal(isBookingStatusTransitionAllowed('cancelled', 'pending'), true);
  assert.equal(isBookingStatusTransitionAllowed('cancelled', 'confirmed'), false);
});

test('a confirmed payment is terminal for every writer', () => {
  assert.deepEqual(PAYMENT_STATUS_TRANSITIONS.confirmed, []);
  assert.equal(isPaymentStatusTransitionAllowed('confirmed', 'failed'), false);
  assert.equal(isPaymentStatusTransitionAllowed('confirmed', 'pending'), false);
  assert.equal(isPaymentStatusTransitionAllowed('pending', 'confirmed'), true);
});

test('every transition has the matching previous-status guard used by the UPDATE', () => {
  for (const [nextStatus, previousStatuses] of Object.entries(
    PAYMENT_STATUS_PREVIOUS_STATUSES
  )) {
    for (const previousStatus of previousStatuses) {
      assert.equal(
        isPaymentStatusTransitionAllowed(previousStatus, nextStatus),
        true,
        `${previousStatus} -> ${nextStatus} should be allowed`
      );
    }
  }

  assert.deepEqual(
    [...PAYMENT_STATUS_PREVIOUS_STATUSES.confirmed].sort(),
    ['expired', 'failed', 'initiating', 'pending']
  );
});

test('only settled payment statuses stop the attendee polling', () => {
  assert.equal(isPaymentStatusTerminal('confirmed'), true);
  assert.equal(isPaymentStatusTerminal('failed'), true);
  assert.equal(isPaymentStatusTerminal('pending'), false);
  assert.equal(isPaymentStatusTerminal('initiating'), false);
});

test('ticket access needs a confirmed seat and a settled or absent payment', () => {
  assert.equal(
    canAttendeeAccessTicketForBooking({
      bookingStatus: 'confirmed',
      paymentStatus: 'confirmed',
    }),
    true
  );
  assert.equal(
    canAttendeeAccessTicketForBooking({
      bookingStatus: 'confirmed',
      paymentStatus: null,
    }),
    true
  );
  assert.equal(
    canAttendeeAccessTicketForBooking({
      bookingStatus: 'confirmed',
      paymentStatus: 'pending',
    }),
    false
  );
  assert.equal(
    canAttendeeAccessTicketForBooking({
      bookingStatus: 'pending',
      paymentStatus: 'confirmed',
    }),
    false
  );
});

test('the booking transition map only contains known booking statuses', () => {
  const knownStatuses = Object.keys(BOOKING_STATUS_TRANSITIONS);
  for (const allowedNextStatuses of Object.values(BOOKING_STATUS_TRANSITIONS)) {
    for (const nextStatus of allowedNextStatuses) {
      assert.ok(knownStatuses.includes(nextStatus), `${nextStatus} is not a booking status`);
    }
  }
});
