import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pool from '../config/db.js';

import {
  createAdminBookingRecord,
  updateAdminBookingRecord,
  confirmAdminBookingRecord,
  fetchAdminBookingList,
  fetchAdminBookingDetail,
  buildAdminBookingListWhereClause,
  BookingNotConfirmableError,
  InvalidAdminBookingStatusError,
} from '../services/adminBookingService.js';

import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

import {
  fetchOfflinePaymentReceiptByPaymentId,
  resolveOfflinePaymentReceiptAbsoluteFilePath,
  storeOfflinePaymentReceiptForPayment,
} from '../services/offlinePaymentReceiptService.js';

import { fetchEventAvailabilitySnapshot } from '../services/bookingService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

async function stubTicketDeliverySucceeds() {
  return { delivered: true };
}

beforeEach(resetDatabaseState);

test('createAdminBookingRecord creates a booking without confirming it', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Admin Created',
    email: 'admincreated@example.com',
    phone_number: '+255712345696',
  });

  assert.equal(createdBooking.status, 'pending');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 0);
  assert.equal(availabilitySnapshot.activeSeatHolds, 1);
});

test('createAdminBookingRecord auto-confirms when autoConfirm is requested', async () => {
  const createdBooking = await createAdminBookingRecord(
    {
      full_name: 'Auto Confirmed',
      email: 'autoconfirmed@example.com',
      phone_number: '+255712345697',
    },
    { autoConfirm: true }
  );

  assert.equal(createdBooking.status, 'confirmed');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 1);
});

test('updateAdminBookingRecord updates attendee details', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Original Name',
    email: 'original@example.com',
    phone_number: '+255712345698',
  });

  const updatedBooking = await updateAdminBookingRecord(createdBooking.id, {
    full_name: 'Updated Name',
    email: 'updated@example.com',
  });

  assert.equal(updatedBooking.full_name, 'Updated Name');
  assert.equal(updatedBooking.email, 'updated@example.com');
  assert.equal(updatedBooking.status, 'pending');
});

test('updateAdminBookingRecord confirms a booking through the capacity gate', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'To Confirm',
    email: 'toconfirm@example.com',
    phone_number: '+255712345699',
  });

  const updatedBooking = await updateAdminBookingRecord(createdBooking.id, {
    status: 'confirmed',
  });

  assert.equal(updatedBooking.status, 'confirmed');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 1);
});

test('updateAdminBookingRecord rejects an invalid status value', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Reject User',
    email: 'reject@example.com',
    phone_number: '+255712345701',
  });

  await assert.rejects(
    () => updateAdminBookingRecord(createdBooking.id, { status: 'nonsense' }),
    (error) => error instanceof InvalidAdminBookingStatusError
  );
});

test('confirmAdminBookingRecord confirms payment, booking and delivers ticket', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Paid User',
    email: 'paid@example.com',
    phone_number: '+255712345702',
  });
  await createPendingPaymentRecordForBooking(createdBooking.id, 'lipanamba');

  let deliveredBookingId = null;
  const confirmationResult = await confirmAdminBookingRecord(
    createdBooking.id,
    async (bookingId) => {
      deliveredBookingId = bookingId;
      return { delivered: true };
    }
  );

  assert.equal(confirmationResult.booking.status, 'confirmed');
  assert.equal(confirmationResult.payment.status, 'confirmed');
  assert.equal(deliveredBookingId, createdBooking.id);

  const confirmedBooking = await pool.query('SELECT status FROM bookings WHERE id = $1', [
    createdBooking.id,
  ]);
  assert.equal(confirmedBooking.rows[0].status, 'confirmed');
});

test('confirmAdminBookingRecord approves the uploaded Lipa Namba receipt', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Lipa Namba User',
    email: 'lipanamba@example.com',
    phone_number: '+255712345706',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    createdBooking.id,
    'lipanamba'
  );

  const offlineReceiptRecord = await storeOfflinePaymentReceiptForPayment({
    paymentRecord,
    bookingRecord: createdBooking,
    receiptFileBuffer: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]),
    originalFileName: 'lipa-namba-receipt.png',
    declaredMimeType: 'image/png',
  });

  try {
    const confirmationResult = await confirmAdminBookingRecord(
      createdBooking.id,
      stubTicketDeliverySucceeds
    );

    assert.equal(confirmationResult.booking.status, 'confirmed');
    assert.equal(confirmationResult.payment.status, 'confirmed');

    const reviewedReceipt = await fetchOfflinePaymentReceiptByPaymentId(paymentRecord.id);
    assert.equal(reviewedReceipt.status, 'approved');
    assert.ok(reviewedReceipt.reviewedAt);
  } finally {
    await fs
      .unlink(resolveOfflinePaymentReceiptAbsoluteFilePath(offlineReceiptRecord))
      .catch(() => {});
  }
});

test('confirmAdminBookingRecord confirms a booking that has no payment record', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Invited Guest',
    email: 'invited@example.com',
    phone_number: '+255712345707',
  });

  let deliveredBookingId = null;
  const confirmationResult = await confirmAdminBookingRecord(
    createdBooking.id,
    async (bookingId) => {
      deliveredBookingId = bookingId;
      return { delivered: true };
    }
  );

  assert.equal(confirmationResult.booking.status, 'confirmed');
  assert.equal(confirmationResult.payment, null);
  assert.equal(deliveredBookingId, createdBooking.id);
});

test('confirmAdminBookingRecord refuses to confirm a cancelled booking', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Cancelled Guest',
    email: 'cancelled@example.com',
    phone_number: '+255712345708',
  });
  await updateAdminBookingRecord(createdBooking.id, { status: 'cancelled' });

  await assert.rejects(
    () => confirmAdminBookingRecord(createdBooking.id, stubTicketDeliverySucceeds),
    (error) => error instanceof BookingNotConfirmableError
  );
});

test('confirmAdminBookingRecord records the payment when the booking was already marked confirmed', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Legacy Confirmed',
    email: 'legacy-confirmed@example.com',
    phone_number: '+255712345710',
  });
  await createPendingPaymentRecordForBooking(createdBooking.id, 'lipanamba');
  await updateAdminBookingRecord(createdBooking.id, { status: 'confirmed' });

  let deliveredBookingId = null;
  const confirmationResult = await confirmAdminBookingRecord(
    createdBooking.id,
    async (bookingId) => {
      deliveredBookingId = bookingId;
      return { delivered: true };
    }
  );

  assert.equal(confirmationResult.booking.status, 'confirmed');
  assert.equal(confirmationResult.payment.status, 'confirmed');
  assert.equal(deliveredBookingId, createdBooking.id);
});

test('confirmAdminBookingRecord does not resend the ticket for an already confirmed booking', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Already Paid',
    email: 'already-paid@example.com',
    phone_number: '+255712345711',
  });
  await createPendingPaymentRecordForBooking(createdBooking.id, 'lipanamba');
  await confirmAdminBookingRecord(createdBooking.id, stubTicketDeliverySucceeds);

  let didDeliverTicketAgain = false;
  const confirmationResult = await confirmAdminBookingRecord(
    createdBooking.id,
    async () => {
      didDeliverTicketAgain = true;
      return { delivered: true };
    }
  );

  assert.equal(confirmationResult.alreadyConfirmed, true);
  assert.equal(didDeliverTicketAgain, false);
});

test('fetchAdminBookingList returns bookings joined with their payment status', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Listed User',
    email: 'listed@example.com',
    phone_number: '+255712345704',
  });
  await createPendingPaymentRecordForBooking(createdBooking.id, 'usdt_bep20');

  const bookingList = await fetchAdminBookingList({});

  const matchedRow = bookingList.find((row) => row.id === createdBooking.id);
  assert.ok(matchedRow);
  assert.equal(matchedRow.payment_method, 'usdt_bep20');
  assert.equal(matchedRow.payment_status, 'pending');
});

test('fetchAdminBookingDetail returns order deposit details for crypto bookings', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Detail User',
    email: 'detail@example.com',
    phone_number: '+255712345705',
  });
  await createPendingPaymentRecordForBooking(createdBooking.id, 'usdt_bep20');

  const bookingDetail = await fetchAdminBookingDetail(createdBooking.id);

  assert.equal(bookingDetail.booking.id, createdBooking.id);
  assert.equal(bookingDetail.payment.payment_method, 'usdt_bep20');
});
test('buildAdminBookingListWhereClause escapes wildcard characters in the search text', () => {
  const { whereClause, queryParameters } = buildAdminBookingListWhereClause({
    searchQuery: '50%_off',
  });

  assert.match(whereClause, /ILIKE/);
  assert.deepEqual(queryParameters, ['%50\\%\\_off%']);
});

test('fetchAdminBookingList filters bookings by attendee name, email, phone, and reference', async () => {
  const targetBooking = await createAdminBookingRecord({
    full_name: 'Search Target',
    email: 'target@example.com',
    phone_number: '+255712345710',
  });
  const otherBooking = await createAdminBookingRecord({
    full_name: 'Other Person',
    email: 'other@example.com',
    phone_number: '+255712345711',
  });

  const nameMatches = await fetchAdminBookingList({ searchQuery: 'search tar' });
  const emailMatches = await fetchAdminBookingList({ searchQuery: 'target@example.com' });
  const phoneMatches = await fetchAdminBookingList({ searchQuery: '0712345710' });
  const referenceMatches = await fetchAdminBookingList({ searchQuery: targetBooking.ref });

  assert.deepEqual(
    nameMatches.map((row) => row.id),
    [targetBooking.id]
  );
  assert.deepEqual(
    emailMatches.map((row) => row.id),
    [targetBooking.id]
  );
  assert.deepEqual(
    phoneMatches.map((row) => row.id),
    [targetBooking.id]
  );
  assert.deepEqual(
    referenceMatches.map((row) => row.id),
    [targetBooking.id]
  );
  assert.equal(
    nameMatches.some((row) => row.id === otherBooking.id),
    false
  );
});

test('fetchAdminBookingList combines the status filter with the search query', async () => {
  const pendingBooking = await createAdminBookingRecord({
    full_name: 'Combined Pending',
    email: 'combined.pending@example.com',
    phone_number: '+255712345712',
  });
  const confirmedBooking = await createAdminBookingRecord({
    full_name: 'Combined Confirmed',
    email: 'combined.confirmed@example.com',
    phone_number: '+255712345713',
  });
  await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [
    'confirmed',
    confirmedBooking.id,
  ]);

  const combinedMatches = await fetchAdminBookingList({
    statusFilter: 'confirmed',
    searchQuery: 'combined',
  });

  assert.deepEqual(
    combinedMatches.map((row) => row.id),
    [confirmedBooking.id]
  );
  assert.equal(
    combinedMatches.some((row) => row.id === pendingBooking.id),
    false
  );
});

test('fetchAdminBookingList treats a typed percent sign as literal text', async () => {
  await createAdminBookingRecord({
    full_name: 'Literal Percent User',
    email: 'literal.percent@example.com',
    phone_number: '+255712345714',
  });

  const percentMatches = await fetchAdminBookingList({ searchQuery: '%' });

  assert.deepEqual(percentMatches, []);
});
