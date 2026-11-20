import pool from '../config/db.js';

import { resolveEffectiveExpectedAmountForPaymentMethod } from './eventConfigAdminService.js';

import {
  VALID_PAYMENT_METHODS,
  CONFIGURED_PAYMENT_METHODS,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
  PAYMENT_METHOD_USDT_BEP20,
} from './eventConfigService.js';

import { PAYMENT_STATUS_PREVIOUS_STATUSES } from './bookingPaymentLifecycleRules.js';

export {
  VALID_PAYMENT_METHODS,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
} from './eventConfigService.js';

export class InvalidPaymentMethodError extends Error {
  constructor(paymentMethod) {
    super(`Invalid payment method: ${paymentMethod}`);
    this.name = 'InvalidPaymentMethodError';
    this.code = 'INVALID_PAYMENT_METHOD';
    this.paymentMethod = paymentMethod;
  }
}

export class PaymentNotFoundError extends Error {
  constructor(paymentId) {
    super(`Payment not found for id ${paymentId}`);
    this.name = 'PaymentNotFoundError';
    this.code = 'PAYMENT_NOT_FOUND';
  }
}

export class PaymentMethodNotAvailableError extends Error {
  constructor(paymentMethod) {
    super(`Payment method is not available for new payments: ${paymentMethod}`);
    this.name = 'PaymentMethodNotAvailableError';
    this.code = 'PAYMENT_METHOD_NOT_AVAILABLE';
    this.paymentMethod = paymentMethod;
  }
}

export class PaymentRecordAlreadyExistsError extends Error {
  constructor(bookingId, existingPaymentMethod) {
    super(
      `Booking ${bookingId} already has a ${existingPaymentMethod} payment record`
    );
    this.name = 'PaymentRecordAlreadyExistsError';
    this.code = 'PAYMENT_RECORD_ALREADY_EXISTS';
    this.bookingId = bookingId;
    this.existingPaymentMethod = existingPaymentMethod;
  }
}

export function validatePaymentMethodSelection(paymentMethod) {
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new InvalidPaymentMethodError(paymentMethod);
  }
  return paymentMethod;
}

// Guards every new payment against a retired method. `azampesa` is still in
// VALID_PAYMENT_METHODS so historical rows stay readable, but it must never be
// selectable again.
export function assertPaymentMethodIsAvailableForNewPayment(paymentMethod) {
  validatePaymentMethodSelection(paymentMethod);
  if (!CONFIGURED_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new PaymentMethodNotAvailableError(paymentMethod);
  }
  return paymentMethod;
}

export function resolveExpectedAmountForPaymentMethod(paymentMethod) {
  validatePaymentMethodSelection(paymentMethod);
  return paymentMethod === PAYMENT_METHOD_USDT_BEP20
    ? TICKET_PRICE_USDT
    : TICKET_PRICE_TZS;
}

export async function createPendingPaymentRecordForBooking(bookingId, paymentMethod) {
  assertPaymentMethodIsAvailableForNewPayment(paymentMethod);

  const amountExpected = await resolveEffectiveExpectedAmountForPaymentMethod(paymentMethod);

  const result = await pool.query(
    `INSERT INTO payments (booking_id, payment_method, amount_expected, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING *`,
    [bookingId, paymentMethod, amountExpected]
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  // A retried request (the attendee pressing submit again after a dropped
  // response) must reach the payment that already exists instead of failing on
  // the one-payment-per-booking constraint.
  const existingPaymentRecord = await fetchPaymentRecordByBookingId(bookingId);
  if (!existingPaymentRecord) {
    throw new Error(`Payment record for booking ${bookingId} could not be created`);
  }
  if (existingPaymentRecord.payment_method !== paymentMethod) {
    throw new PaymentRecordAlreadyExistsError(
      bookingId,
      existingPaymentRecord.payment_method
    );
  }

  return existingPaymentRecord;
}

export async function fetchPaymentRecordByBookingId(bookingId) {
  const result = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [bookingId]);
  return result.rows[0] ?? null;
}

export async function fetchPaymentRecordById(paymentId) {
  const result = await pool.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
  return result.rows[0] ?? null;
}

// Accepts the UUID shape only. A legacy numeric id must be rejected before it
// reaches Postgres, otherwise the uuid comparison raises a 22P02 instead of
// producing the 404 that hides whether the record exists.
const PAYMENT_PUBLIC_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPaymentPublicTokenFormat(paymentPublicToken) {
  return PAYMENT_PUBLIC_TOKEN_PATTERN.test(String(paymentPublicToken ?? ''));
}

export async function fetchPaymentRecordByPublicToken(paymentPublicToken) {
  if (!isValidPaymentPublicTokenFormat(paymentPublicToken)) {
    return null;
  }
  const result = await pool.query(
    'SELECT * FROM payments WHERE public_token = $1',
    [paymentPublicToken]
  );
  return result.rows[0] ?? null;
}

// The only writer for payment status. The UPDATE carries the statuses the new
// status may come from, so a late or replayed callback can no longer
// downgrade a confirmed payment. A blocked transition returns null instead of
// throwing: a duplicate success callback is normal and must stay silent.
export async function updatePaymentRecordStatus(paymentId, newPaymentStatus) {
  const previousStatuses = PAYMENT_STATUS_PREVIOUS_STATUSES[newPaymentStatus];
  if (!previousStatuses) {
    throw new Error(`Unknown payment status: ${newPaymentStatus}`);
  }

  const result = await pool.query(
    `UPDATE payments
        SET status = $1,
            confirmed_at = CASE WHEN $1::payment_status = 'confirmed' THEN now() ELSE NULL END
      WHERE id = $2
        AND status = ANY($3::payment_status[])
      RETURNING *`,
    [newPaymentStatus, paymentId, previousStatuses]
  );

  return result.rows[0] ?? null;
}

