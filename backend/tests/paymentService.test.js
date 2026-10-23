import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  createPendingPaymentRecordForBooking,
  fetchPaymentRecordByBookingId,
  resolveExpectedAmountForPaymentMethod,
  updatePaymentRecordStatus,
  validatePaymentMethodSelection,
  assertPaymentMethodIsAvailableForNewPayment,
  InvalidPaymentMethodError,
  PaymentMethodNotAvailableError,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
} from '../services/paymentService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

test('validatePaymentMethodSelection accepts azampesa, usdt_bep20, and lipanamba', () => {
  assert.equal(validatePaymentMethodSelection('azampesa'), 'azampesa');
  assert.equal(validatePaymentMethodSelection('usdt_bep20'), 'usdt_bep20');
  assert.equal(validatePaymentMethodSelection('lipanamba'), 'lipanamba');
  assert.throws(
    () => validatePaymentMethodSelection('mpesa'),
    (error) => error instanceof InvalidPaymentMethodError
  );
});

test('resolveExpectedAmountForPaymentMethod maps local methods to TZS and usdt to 3.8 USDT', () => {
  assert.equal(resolveExpectedAmountForPaymentMethod('azampesa'), TICKET_PRICE_TZS);
  assert.equal(resolveExpectedAmountForPaymentMethod('lipanamba'), TICKET_PRICE_TZS);
  assert.equal(resolveExpectedAmountForPaymentMethod('usdt_bep20'), TICKET_PRICE_USDT);
});

test('assertPaymentMethodIsAvailableForNewPayment refuses the retired AzamPesa method', async () => {
  assert.equal(assertPaymentMethodIsAvailableForNewPayment('lipanamba'), 'lipanamba');
  assert.equal(assertPaymentMethodIsAvailableForNewPayment('usdt_bep20'), 'usdt_bep20');

  assert.throws(
    () => assertPaymentMethodIsAvailableForNewPayment('azampesa'),
    (error) => error instanceof PaymentMethodNotAvailableError
  );

  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Retired Method User',
    email: 'retired-method@example.com',
    phone_number: '+255712345699',
  });

  await assert.rejects(
    () => createPendingPaymentRecordForBooking(bookingRecord.id, 'azampesa'),
    (error) => error.code === 'PAYMENT_METHOD_NOT_AVAILABLE'
  );
});

test('createPendingPaymentRecordForBooking creates a pending payment linked to the booking', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Payment User',
    email: 'payment@example.com',
    phone_number: '+255712345682',
  });

  const paymentRecord = await createPendingPaymentRecordForBooking(bookingRecord.id, 'lipanamba');

  assert.equal(paymentRecord.booking_id, bookingRecord.id);
  assert.equal(paymentRecord.payment_method, 'lipanamba');
  assert.equal(paymentRecord.status, 'pending');
  assert.equal(Number(paymentRecord.amount_expected), TICKET_PRICE_TZS);

  const fetchedPayment = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(fetchedPayment.id, paymentRecord.id);
  assert.equal(Number(fetchedPayment.amount_expected), TICKET_PRICE_TZS);
});

test('updatePaymentRecordStatus sets confirmed_at when status becomes confirmed', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Confirm User',
    email: 'confirm@example.com',
    phone_number: '+255712345683',
  });

  const paymentRecord = await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');

  const confirmedPayment = await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');

  assert.equal(confirmedPayment.status, 'confirmed');
  assert.ok(confirmedPayment.confirmed_at);

  const invalidUpdate = await updatePaymentRecordStatus(999999, 'confirmed');
  assert.equal(invalidUpdate, null);
});

test('updatePaymentRecordStatus clears confirmed_at when reverting from confirmed', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Revert User',
    email: 'revert@example.com',
    phone_number: '+255712345684',
  });

  const paymentRecord = await createPendingPaymentRecordForBooking(bookingRecord.id, 'lipanamba');
  await updatePaymentRecordStatus(paymentRecord.id, 'confirmed');

  const revertedPayment = await updatePaymentRecordStatus(paymentRecord.id, 'pending');
  assert.equal(revertedPayment.status, 'pending');
  assert.equal(revertedPayment.confirmed_at, null);
});
