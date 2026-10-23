import pool from '../config/db.js';

// Money that arrived but could not be settled automatically is parked in
// payment_review_flags by the USDT listener. This service is the human side of
// that workflow: list what needs attention, then record what was decided.

export class PaymentReviewFlagNotFoundError extends Error {
  constructor(paymentReviewFlagId) {
    super(`Payment review flag ${paymentReviewFlagId} was not found or is already resolved`);
    this.name = 'PaymentReviewFlagNotFoundError';
    this.code = 'PAYMENT_REVIEW_FLAG_NOT_FOUND';
  }
}

const DEFAULT_PAYMENT_REVIEW_FLAG_LIMIT = 100;
const MAXIMUM_PAYMENT_REVIEW_FLAG_LIMIT = 500;

function normalizePaymentReviewFlagRecord(flagRow) {
  if (!flagRow) {
    return null;
  }

  return {
    id: Number(flagRow.id),
    orderId: flagRow.order_id === null ? null : Number(flagRow.order_id),
    bookingId: flagRow.booking_id === null ? null : Number(flagRow.booking_id),
    paymentId: flagRow.payment_id === null ? null : Number(flagRow.payment_id),
    bookingReferenceCode: flagRow.booking_ref ?? null,
    attendeeFullName: flagRow.full_name ?? null,
    attendeeEmailAddress: flagRow.email ?? null,
    paymentMethod: flagRow.payment_method ?? null,
    paymentStatus: flagRow.payment_status ?? null,
    depositAddress: flagRow.deposit_address,
    txHash: flagRow.tx_hash,
    amount: flagRow.amount === null ? null : Number(flagRow.amount),
    reason: flagRow.reason,
    details: flagRow.details,
    autoAction: flagRow.auto_action,
    resolvedAt: flagRow.resolved_at,
    resolutionNote: flagRow.resolution_note,
    createdAt: flagRow.created_at,
  };
}

function clampPaymentReviewFlagLimit(requestedLimit) {
  const parsedLimit = Number(requestedLimit);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return DEFAULT_PAYMENT_REVIEW_FLAG_LIMIT;
  }
  return Math.min(Math.floor(parsedLimit), MAXIMUM_PAYMENT_REVIEW_FLAG_LIMIT);
}

export async function fetchPaymentReviewFlags({
  includeResolved = false,
  limit = DEFAULT_PAYMENT_REVIEW_FLAG_LIMIT,
} = {}) {
  const fetchResult = await pool.query(
    `SELECT flag.*,
            bookings.ref   AS booking_ref,
            bookings.full_name,
            bookings.email,
            payments.payment_method,
            payments.status AS payment_status
       FROM payment_review_flags flag
       LEFT JOIN bookings ON bookings.id = flag.booking_id
       LEFT JOIN payments ON payments.id = flag.payment_id
      WHERE ($1::boolean OR flag.resolved_at IS NULL)
      ORDER BY flag.created_at DESC, flag.id DESC
      LIMIT $2`,
    [includeResolved, clampPaymentReviewFlagLimit(limit)]
  );

  return fetchResult.rows.map(normalizePaymentReviewFlagRecord);
}

export async function resolvePaymentReviewFlag({ paymentReviewFlagId, resolutionNote }) {
  const updateResult = await pool.query(
    `UPDATE payment_review_flags
        SET resolved_at = now(),
            resolution_note = $2
      WHERE id = $1
        AND resolved_at IS NULL
      RETURNING *`,
    [paymentReviewFlagId, resolutionNote]
  );

  if (updateResult.rows.length === 0) {
    throw new PaymentReviewFlagNotFoundError(paymentReviewFlagId);
  }

  const resolvedFlagRow = updateResult.rows[0];
  const joinedResult = await pool.query(
    `SELECT flag.*,
            bookings.ref   AS booking_ref,
            bookings.full_name,
            bookings.email,
            payments.payment_method,
            payments.status AS payment_status
       FROM payment_review_flags flag
       LEFT JOIN bookings ON bookings.id = flag.booking_id
       LEFT JOIN payments ON payments.id = flag.payment_id
      WHERE flag.id = $1`,
    [resolvedFlagRow.id]
  );

  return normalizePaymentReviewFlagRecord(joinedResult.rows[0]);
}
