import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  createOrderWithDepositAddressForBooking,
  fetchOrderByBookingId,
  fetchDepositAddressByOrderId,
  fetchConfirmableDepositAddressRecords,
  reissueDepositAddressForOrder,
  updateOrderStatus,
  revokeExpiredOrderHolds,
  OrderAlreadyExistsError,
} from '../services/orderService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createBookingForOrderTest() {
  return createBookingRecordWithActiveSeatHold({
    full_name: 'Order User',
    email: 'order@example.com',
    phone_number: '+255712345677',
  });
}

test('createOrderWithDepositAddressForBooking creates an order with a unique derived address', async () => {
  const bookingRecord = await createBookingForOrderTest();

  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

  assert.equal(createdOrder.booking_id, bookingRecord.id);
  assert.equal(createdOrder.status, 'pending');
  assert.equal(Number(createdOrder.amount_usdt), 3.8);
  assert.ok(Number.isInteger(createdOrder.customer_id));
  assert.ok(createdOrder.customer_id >= 1);
  assert.match(createdOrder.deposit_address, /^0x[a-fA-F0-9]{40}$/);

  const storedOrder = await fetchOrderByBookingId(bookingRecord.id);
  assert.equal(storedOrder.id, createdOrder.id);

  const depositAddressRecord = await fetchDepositAddressByOrderId(createdOrder.id);
  assert.equal(depositAddressRecord.address, createdOrder.deposit_address);
  assert.equal(depositAddressRecord.derivation_index, createdOrder.customer_id);
});

test('createOrderWithDepositAddressForBooking rejects a second order for the same booking', async () => {
  const bookingRecord = await createBookingForOrderTest();
  await createOrderWithDepositAddressForBooking(bookingRecord.id);

  await assert.rejects(
    () => createOrderWithDepositAddressForBooking(bookingRecord.id),
    (error) => error instanceof OrderAlreadyExistsError
  );
});

test('customer_id derivation index is monotonic and never reused across orders', async () => {
  const firstBooking = await createBookingForOrderTest();
  const firstOrder = await createOrderWithDepositAddressForBooking(firstBooking.id);

  const secondBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Order User Two',
    email: 'order2@example.com',
    phone_number: '+255712345678',
  });
  const secondOrder = await createOrderWithDepositAddressForBooking(secondBooking.id);

  assert.ok(secondOrder.customer_id > firstOrder.customer_id);
  assert.notEqual(firstOrder.deposit_address, secondOrder.deposit_address);
});

test('a reissued order yields one confirmable address, the active one', async () => {
  const bookingRecord = await createBookingForOrderTest();
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  const originalAddress = createdOrder.deposit_address;

  await pool.query(
    `UPDATE orders SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [createdOrder.id]
  );
  const renewedOrder = await reissueDepositAddressForOrder(createdOrder.id);

  const confirmableRecords = await fetchConfirmableDepositAddressRecords();
  assert.equal(confirmableRecords.length, 1);
  assert.equal(confirmableRecords[0].address, renewedOrder.deposit_address);
  assert.notEqual(confirmableRecords[0].address, originalAddress);
  assert.equal(confirmableRecords[0].is_active, true);
});

test('updateOrderStatus transitions an order to paid then swept', async () => {
  const bookingRecord = await createBookingForOrderTest();
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

  const paidOrder = await updateOrderStatus(createdOrder.id, 'paid');
  assert.equal(paidOrder.status, 'paid');

  const sweptOrder = await updateOrderStatus(createdOrder.id, 'swept');
  assert.equal(sweptOrder.status, 'swept');
});

test('revokeExpiredOrderHolds marks only overdue pending orders as expired', async () => {
  const bookingRecord = await createBookingForOrderTest();
  const createdOrder = await createOrderWithDepositAddressForBooking(
    bookingRecord.id,
    1 // 1-minute expiry for the test
  );

  await pool.query(
    "UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [createdOrder.id]
  );

  const expiredCount = await revokeExpiredOrderHolds();
  assert.equal(expiredCount, 1);

  const storedOrder = await fetchOrderByBookingId(bookingRecord.id);
  assert.equal(storedOrder.status, 'expired');

  const secondBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Order User Three',
    email: 'order3@example.com',
    phone_number: '+255712345679',
  });
  await createOrderWithDepositAddressForBooking(secondBooking.id);

  const secondExpiredCount = await revokeExpiredOrderHolds();
  assert.equal(secondExpiredCount, 0);
});
