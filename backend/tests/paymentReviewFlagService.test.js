import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { recordPaymentReviewFlag } from '../services/usdtPaymentService.js';
import {
  fetchPaymentReviewFlags,
  resolvePaymentReviewFlag,
  PaymentReviewFlagNotFoundError,
} from '../services/paymentReviewFlagService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createReviewFlagFixture({ txHash, reason = 'overpayment' }) {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Flagged Attendee',
    email: 'flagged-attendee@example.com',
    phone_number: '+255712345691',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'usdt_bep20'
  );

  const reviewFlagRow = await recordPaymentReviewFlag({
    bookingId: bookingRecord.id,
    paymentId: paymentRecord.id,
    txHash,
    amount: 1.5,
    reason,
    details: { observedAmount: '1.5', expectedAmount: '3.8' },
    autoAction: 'none',
  });

  return { bookingRecord, paymentRecord, reviewFlagRow };
}

test('fetchPaymentReviewFlags returns unresolved flags with booking context', async () => {
  await createReviewFlagFixture({ txHash: '0xflagone' });

  const unresolvedFlags = await fetchPaymentReviewFlags();

  assert.equal(unresolvedFlags.length, 1);
  const [reviewFlag] = unresolvedFlags;
  assert.equal(reviewFlag.reason, 'overpayment');
  assert.equal(reviewFlag.bookingReferenceCode.length > 0, true);
  assert.equal(reviewFlag.attendeeFullName, 'Flagged Attendee');
  assert.equal(reviewFlag.paymentMethod, 'usdt_bep20');
  assert.equal(reviewFlag.resolvedAt, null);
});

test('resolvePaymentReviewFlag records the decision and hides the flag from the unresolved list', async () => {
  const { reviewFlagRow } = await createReviewFlagFixture({ txHash: '0xflagtwo' });

  const resolvedFlag = await resolvePaymentReviewFlag({
    paymentReviewFlagId: Number(reviewFlagRow.id),
    resolutionNote: 'Refunded the overpayment to the attendee.',
  });

  assert.ok(resolvedFlag.resolvedAt);
  assert.equal(resolvedFlag.resolutionNote, 'Refunded the overpayment to the attendee.');

  const unresolvedFlags = await fetchPaymentReviewFlags();
  assert.equal(unresolvedFlags.length, 0);

  const flagsIncludingResolved = await fetchPaymentReviewFlags({ includeResolved: true });
  assert.equal(flagsIncludingResolved.length, 1);
  assert.equal(flagsIncludingResolved[0].id, Number(reviewFlagRow.id));
});

test('resolvePaymentReviewFlag refuses to resolve the same flag twice', async () => {
  const { reviewFlagRow } = await createReviewFlagFixture({ txHash: '0xflgthree' });

  await resolvePaymentReviewFlag({
    paymentReviewFlagId: Number(reviewFlagRow.id),
    resolutionNote: 'Accepted the overpayment as a donation.',
  });

  await assert.rejects(
    () =>
      resolvePaymentReviewFlag({
        paymentReviewFlagId: Number(reviewFlagRow.id),
        resolutionNote: 'A second decision that must not overwrite the first.',
      }),
    (error) => error instanceof PaymentReviewFlagNotFoundError
  );
});
