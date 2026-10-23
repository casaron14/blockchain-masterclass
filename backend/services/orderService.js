import pool from '../config/db.js';

import { deriveDepositAddressForDerivationIndex } from './depositAddressDerivationService.js';

import { SEAT_HOLD_DURATION_MINUTES, TICKET_PRICE_USDT } from './eventConfigService.js';

export const ORDER_STATUS_VALUES = Object.freeze(['pending', 'paid', 'expired', 'swept']);
export const ORDER_DEFAULT_EXPIRY_MINUTES = SEAT_HOLD_DURATION_MINUTES;

// An order whose status is in this list may still receive a transfer that has
// to be attributed to somebody, so its deposit addresses stay in the listener's
// watch set. A swept order whose treasury transfer is already recorded does not
// need to be watched any more.
export const WATCHABLE_ORDER_STATUSES = Object.freeze(['pending', 'paid', 'expired']);

export class OrderNotFoundError extends Error {
  constructor(orderId) {
    super(`Order not found for id ${orderId}`);
    this.name = 'OrderNotFoundError';
    this.code = 'ORDER_NOT_FOUND';
  }
}

export class OrderAlreadyExistsError extends Error {
  constructor(bookingId) {
    super(`An order already exists for booking ${bookingId}`);
    this.name = 'OrderAlreadyExistsError';
    this.code = 'ORDER_ALREADY_EXISTS';
  }
}

export class OrderAddressAlreadyFundedError extends Error {
  constructor(orderId) {
    super(`Order ${orderId} already received a payment on its deposit address`);
    this.name = 'OrderAddressAlreadyFundedError';
    this.code = 'ORDER_ALREADY_FUNDED';
  }
}

function validateOrderStatusForUpdate(newOrderStatus) {
  if (!ORDER_STATUS_VALUES.includes(newOrderStatus)) {
    throw new Error(`Invalid order status: ${newOrderStatus}`);
  }
  return newOrderStatus;
}

async function allocateNextDerivationIndex(client) {
  const result = await client.query('SELECT nextval(\'customer_derivation_seq\') AS derivation_index');
  return Number(result.rows[0].derivation_index);
}

function normalizeOrderRow(orderRow) {
  if (!orderRow) {
    return null;
  }
  return {
    ...orderRow,
    id: Number(orderRow.id),
    booking_id: Number(orderRow.booking_id),
    customer_id: Number(orderRow.customer_id),
  };
}

function normalizeDepositAddressRow(addressRow) {
  if (!addressRow) {
    return null;
  }
  return {
    ...addressRow,
    id: Number(addressRow.id),
    order_id: Number(addressRow.order_id),
    derivation_index: Number(addressRow.derivation_index),
    last_scanned_block: Number(addressRow.last_scanned_block),
    is_active: addressRow.is_active === true,
  };
}

// Creates the order row plus its first deposit address. The derivation index
// is allocated from the monotonic DB sequence, so it is never reused even when
// an earlier address expires unpaid.
export async function createOrderWithDepositAddressForBooking(bookingId, orderExpiryMinutes = ORDER_DEFAULT_EXPIRY_MINUTES) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingOrderResult = await client.query(
      'SELECT id FROM orders WHERE booking_id = $1',
      [bookingId]
    );
    if (existingOrderResult.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new OrderAlreadyExistsError(bookingId);
    }

    const derivationIndex = await allocateNextDerivationIndex(client);
    const { address } = deriveDepositAddressForDerivationIndex(derivationIndex);

    const orderResult = await client.query(
      `INSERT INTO orders
         (booking_id, customer_id, ticket_ids, amount_usdt, status, expires_at)
       VALUES ($1, $2, '[]', $4, 'pending',
               now() + make_interval(mins => $3))
       RETURNING *`,
      [bookingId, derivationIndex, orderExpiryMinutes, TICKET_PRICE_USDT]
    );
    const createdOrder = orderResult.rows[0];

    await client.query(
      `INSERT INTO deposit_addresses (order_id, derivation_index, address, is_active)
       VALUES ($1, $2, $3, true)`,
      [createdOrder.id, derivationIndex, address]
    );

    await client.query('COMMIT');
    return {
      ...createdOrder,
      id: Number(createdOrder.id),
      customer_id: Number(createdOrder.customer_id),
      deposit_address: address,
      derivation_index: derivationIndex,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Hands a fresh deposit address to a booking whose hold lapsed unpaid. The
// previous address is kept (superseded, not deleted) because a client may still
// send to it, and the listener must be able to attribute that late payment.
// Refuses when money has already been seen on the current address: in that case
// the payment is being processed and replacing the address would hide it.
export async function reissueDepositAddressForOrder(orderId, orderExpiryMinutes = ORDER_DEFAULT_EXPIRY_MINUTES) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lockedOrderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const orderRecord = lockedOrderResult.rows[0];
    if (!orderRecord) {
      await client.query('ROLLBACK');
      throw new OrderNotFoundError(orderId);
    }
    if (orderRecord.status === 'paid' || orderRecord.status === 'swept') {
      await client.query('ROLLBACK');
      throw new OrderAddressAlreadyFundedError(orderId);
    }

    const observedDepositResult = await client.query(
      'SELECT count(*) AS observed_count FROM deposits_observed WHERE order_id = $1',
      [orderId]
    );
    if (Number(observedDepositResult.rows[0].observed_count) > 0) {
      await client.query('ROLLBACK');
      throw new OrderAddressAlreadyFundedError(orderId);
    }

    await client.query(
      `UPDATE deposit_addresses
          SET is_active = false, superseded_at = now()
        WHERE order_id = $1 AND is_active = true`,
      [orderId]
    );

    const derivationIndex = await allocateNextDerivationIndex(client);
    const { address } = deriveDepositAddressForDerivationIndex(derivationIndex);

    await client.query(
      `INSERT INTO deposit_addresses (order_id, derivation_index, address, is_active)
       VALUES ($1, $2, $3, true)`,
      [orderId, derivationIndex, address]
    );

    const renewedOrderResult = await client.query(
      `UPDATE orders
          SET status = 'pending',
              expires_at = now() + make_interval(mins => $2)
        WHERE id = $1
        RETURNING *`,
      [orderId, orderExpiryMinutes]
    );

    await client.query('COMMIT');
    return {
      ...normalizeOrderRow(renewedOrderResult.rows[0]),
      deposit_address: address,
      derivation_index: derivationIndex,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function fetchOrderByBookingId(bookingId) {
  const result = await pool.query('SELECT * FROM orders WHERE booking_id = $1', [bookingId]);
  return normalizeOrderRow(result.rows[0]);
}

export async function fetchOrderById(orderId) {
  const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return normalizeOrderRow(result.rows[0]);
}

export async function fetchDepositAddressByOrderId(orderId) {
  const result = await pool.query(
    'SELECT * FROM deposit_addresses WHERE order_id = $1 AND is_active = true',
    [orderId]
  );
  return normalizeDepositAddressRow(result.rows[0]);
}

// Every address an order has ever been given, active or superseded. Both are
// watched: a client holding an older address may still pay it.
export async function fetchDepositAddressRecordsForOrderId(orderId) {
  const result = await pool.query(
    `SELECT * FROM deposit_addresses
      WHERE order_id = $1
      ORDER BY is_active DESC, id ASC`,
    [orderId]
  );
  return result.rows.map(normalizeDepositAddressRow);
}

export async function fetchDepositAddressByAddress(depositAddress) {
  const result = await pool.query(
    'SELECT * FROM deposit_addresses WHERE address = $1',
    [depositAddress]
  );
  return result.rows[0] ?? null;
}

export async function fetchActiveOrderDepositAddressForBooking(bookingId) {
  const orderRecord = await fetchOrderByBookingId(bookingId);
  if (!orderRecord) {
    return null;
  }

  const addressRecord = await fetchDepositAddressByOrderId(orderRecord.id);
  if (!addressRecord) {
    return null;
  }

  return {
    order: orderRecord,
    depositAddress: addressRecord.address,
    derivationIndex: addressRecord.derivation_index,
  };
}

export async function updateOrderStatus(orderId, newOrderStatus) {
  validateOrderStatusForUpdate(newOrderStatus);
  const result = await pool.query(
    'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
    [newOrderStatus, orderId]
  );
  return result.rows[0] ?? null;
}

export async function fetchOrderRecordsByStatuses(orderStatuses) {
  const result = await pool.query(
    'SELECT * FROM orders WHERE status = ANY($1::order_status[])',
    [orderStatuses]
  );
  return result.rows.map(normalizeOrderRow);
}

export async function fetchPendingOrderRecords() {
  return fetchOrderRecordsByStatuses(['pending']);
}

export async function fetchPaidOrderRecords() {
  return fetchOrderRecordsByStatuses(['paid']);
}

export async function expireOrderById(orderId) {
  return updateOrderStatus(orderId, 'expired');
}

export async function markOrderAsPaid(orderId) {
  return updateOrderStatus(orderId, 'paid');
}

export async function markOrderAsSwept(orderId) {
  return updateOrderStatus(orderId, 'swept');
}

export async function revokeExpiredOrderHolds() {
  const result = await pool.query(
    `UPDATE orders
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()
      RETURNING id`
  );
  return result.rows.length;
}

// The listener's watch set: every deposit address that could still receive a
// transfer, in one query, so a tick costs one address lookup instead of one per
// open order.
export async function fetchWatchableDepositAddressRecords() {
  const result = await pool.query(
    `SELECT da.id, da.order_id, da.derivation_index, da.address, da.is_active,
            da.last_scanned_block, da.last_observed_at,
            o.booking_id, o.status AS order_status, o.expires_at,
            p.id AS payment_id, p.status AS payment_status,
            p.amount_expected, p.payment_method
       FROM deposit_addresses da
       JOIN orders o ON o.id = da.order_id
       LEFT JOIN payments p ON p.booking_id = o.booking_id
      WHERE o.status = ANY($1::order_status[])
      ORDER BY da.order_id ASC, da.is_active DESC`,
    [WATCHABLE_ORDER_STATUSES]
  );
  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    order_id: Number(row.order_id),
    booking_id: Number(row.booking_id),
    derivation_index: Number(row.derivation_index),
    last_scanned_block: Number(row.last_scanned_block),
    is_active: row.is_active === true,
  }));
}

// The subset of the watch set whose payment can still be confirmed: a live hold
// (pending order) or a hold that lapsed but whose booking is still confirmable.
export async function fetchConfirmableDepositAddressRecords() {
  const result = await pool.query(
    `SELECT da.id, da.order_id, da.derivation_index, da.address, da.is_active,
            da.last_scanned_block, da.last_observed_at,
            o.booking_id, o.status AS order_status, o.expires_at,
            b.status AS booking_status,
            p.id AS payment_id, p.status AS payment_status,
            p.amount_expected, p.payment_method
       FROM deposit_addresses da
       JOIN orders o ON o.id = da.order_id
       JOIN bookings b ON b.id = o.booking_id
       LEFT JOIN payments p ON p.booking_id = o.booking_id
      WHERE o.status = ANY($1::order_status[])
        AND p.payment_method = 'usdt_bep20'
        AND p.status <> 'confirmed'
      ORDER BY da.order_id ASC, da.is_active DESC`,
    [WATCHABLE_ORDER_STATUSES]
  );
  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    order_id: Number(row.order_id),
    booking_id: Number(row.booking_id),
    derivation_index: Number(row.derivation_index),
    last_scanned_block: Number(row.last_scanned_block),
    is_active: row.is_active === true,
  }));
}

export async function markDepositAddressAsObserved(depositAddressRecordId, observedAtBlockNumber) {
  const result = await pool.query(
    `UPDATE deposit_addresses
        SET last_observed_at = now(),
            last_scanned_block = GREATEST(last_scanned_block, $2)
      WHERE id = $1
      RETURNING *`,
    [depositAddressRecordId, observedAtBlockNumber]
  );
  return normalizeDepositAddressRow(result.rows[0]);
}

export async function fetchPaidOrdersAwaitingSweep() {
  const result = await pool.query(
    `SELECT o.id AS order_id, o.customer_id, o.amount_usdt,
            o.booking_id, o.expires_at,
            da.address AS deposit_address, da.derivation_index
       FROM orders o
       JOIN deposit_addresses da ON da.order_id = o.id AND da.is_active = true
      WHERE o.status = 'paid'
      ORDER BY o.expires_at ASC`
  );
  return result.rows.map((row) => ({
    ...row,
    order_id: Number(row.order_id),
    customer_id: Number(row.customer_id),
    booking_id: Number(row.booking_id),
    derivation_index: Number(row.derivation_index),
  }));
}
