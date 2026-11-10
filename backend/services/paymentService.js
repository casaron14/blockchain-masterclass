import pool from '../config/db.js';

import {
  initiateAzamPayMobileCheckout,
  generateAzamPayExternalId,
} from './azamPayClient.js';

import { confirmBookingSeatWithinCapacity } from './bookingService.js';

import { deliverTicketForConfirmedBooking } from './ticketDeliveryService.js';

import { resolveEffectiveExpectedAmountForPaymentMethod } from './eventConfigAdminService.js';

import {
  VALID_PAYMENT_METHODS,
  CONFIGURED_PAYMENT_METHODS,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_USDT_BEP20,
} from './eventConfigService.js';

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
     RETURNING *`,
    [bookingId, paymentMethod, amountExpected]
  );

  return result.rows[0];
}

export async function fetchPaymentRecordByBookingId(bookingId) {
  const result = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [bookingId]);
  return result.rows[0] ?? null;
}

export async function fetchPaymentRecordById(paymentId) {
  const result = await pool.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
  return result.rows[0] ?? null;
}

export async function updatePaymentRecordStatus(paymentId, newPaymentStatus) {
  const confirmedAtClause =
    newPaymentStatus === 'confirmed' ? "confirmed_at = now()" : "confirmed_at = NULL";

  const result = await pool.query(
    `UPDATE payments
        SET status = $1, ${confirmedAtClause}
      WHERE id = $2
      RETURNING *`,
    [newPaymentStatus, paymentId]
  );

  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------
// AzamPesa (AzamPay) payment flow
// ---------------------------------------------------------------------

export function isBookingHoldExpired(bookingRecord) {
  return new Date(bookingRecord.expires_at).getTime() < Date.now();
}

export async function storeInboundWebhookPayload(paymentId, rawPayload) {
  await pool.query(
    'INSERT INTO payment_webhooks (payment_id, payload) VALUES ($1, $2)',
    [paymentId, JSON.stringify(rawPayload)]
  );
}

async function setPaymentReferenceId(paymentId, externalId) {
  await pool.query(
    `UPDATE payments
        SET reference_id = $1,
            status = CASE WHEN status = 'confirmed' THEN status ELSE 'initiating' END,
            confirmed_at = CASE WHEN status = 'confirmed' THEN confirmed_at ELSE NULL END
      WHERE id = $2`,
    [externalId, paymentId]
  );
}

async function recordAzamPesaTransaction(paymentId, transactionId, amountInTzs) {
  await pool.query(
    `INSERT INTO azampesa (payment_id, tx_id, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (tx_id) DO NOTHING`,
    [paymentId, transactionId, amountInTzs]
  );
}

export async function initiateAzamPesaPayment(bookingId, bookingRecord, phoneNumberOverride) {
  if (isBookingHoldExpired(bookingRecord)) {
    throw new Error('AZAMPESA_HOLD_EXPIRED');
  }

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingId);
  if (!paymentRecord) {
    throw new Error('AZAMPESA_PAYMENT_NOT_FOUND');
  }
  if (paymentRecord.payment_method !== PAYMENT_METHOD_AZAMPESA) {
    throw new Error('AZAMPESA_INVALID_METHOD');
  }

  const externalId = generateAzamPayExternalId();

  await setPaymentReferenceId(paymentRecord.id, externalId);

  const stkPhoneNumber = phoneNumberOverride ?? bookingRecord.phone_number;

  try {
    const checkoutResponse = await initiateAzamPayMobileCheckout(
      stkPhoneNumber,
      Number(paymentRecord.amount_expected),
      externalId
    );

    const transactionId = checkoutResponse.transactionId;
    if (!transactionId) {
      throw new Error('AzamPay checkout response missing transactionId');
    }

    await recordAzamPesaTransaction(paymentRecord.id, transactionId, Number(paymentRecord.amount_expected));

    const latestPaymentRecord = await fetchPaymentRecordById(paymentRecord.id);
    const currentPaymentStatus = latestPaymentRecord?.status ?? paymentRecord.status;

    let finalPaymentStatus = currentPaymentStatus;
    if (currentPaymentStatus !== 'confirmed') {
      await updatePaymentRecordStatus(paymentRecord.id, 'pending');
      finalPaymentStatus = 'pending';
    }

    return { externalId, transactionId, status: finalPaymentStatus };
  } catch (error) {
    await updatePaymentRecordStatus(paymentRecord.id, 'failed');
    throw error;
  }
}

export async function findAzamPayPaymentRecordByExternalId(externalId) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE reference_id = $1 AND payment_method = $2',
    [externalId, PAYMENT_METHOD_AZAMPESA]
  );
  return result.rows[0] ?? null;
}

export async function processAzamPayWebhook(
  webhookPayload,
  deliverTicket = deliverTicketForConfirmedBooking
) {
  const utilityRef = webhookPayload.utilityref;
  const transactionStatus = webhookPayload.transactionstatus;

  if (!utilityRef || !transactionStatus) {
    throw new Error('AZAMPAY_WEBHOOK_MISSING_FIELDS');
  }

  const matchedPaymentRecord = await findAzamPayPaymentRecordByExternalId(utilityRef);
  if (!matchedPaymentRecord) {
    throw new Error('AZAMPAY_WEBHOOK_UNKNOWN_TRANSACTION');
  }

  const paymentId = matchedPaymentRecord.id;
  await storeInboundWebhookPayload(paymentId, webhookPayload);

  if (transactionStatus === 'success') {
    await updatePaymentRecordStatus(paymentId, 'confirmed');
    await confirmBookingSeatWithinCapacity(matchedPaymentRecord.booking_id);
    await deliverTicket(matchedPaymentRecord.booking_id);
  } else if (
    transactionStatus === 'failed' ||
    transactionStatus === 'declined' ||
    transactionStatus === 'cancelled'
  ) {
    await updatePaymentRecordStatus(paymentId, 'failed');
  }

  return {
    paymentId,
    utilityRef,
    transactionStatus,
    bookingId: matchedPaymentRecord.booking_id,
  };
}

