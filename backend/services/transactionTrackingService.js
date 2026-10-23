import pool from '../config/db.js';

import {
  VALID_PAYMENT_METHODS,
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_LIPANAMBA,
} from './eventConfigService.js';

export const TRANSACTION_METHOD_VALUES = Object.freeze([...VALID_PAYMENT_METHODS]);

export const TRANSACTION_PAYMENT_STATUS_VALUES = Object.freeze([
  'initiating',
  'pending',
  'confirmed',
  'failed',
  'expired',
]);

export class InvalidTransactionMethodFilterError extends Error {
  constructor(invalidMethodFilter) {
    super(`Invalid transaction method filter: ${invalidMethodFilter}`);
    this.name = 'InvalidTransactionMethodFilterError';
    this.code = 'INVALID_TRANSACTION_METHOD';
  }
}

export class InvalidTransactionPaymentStatusFilterError extends Error {
  constructor(invalidPaymentStatusFilter) {
    super(`Invalid transaction payment status filter: ${invalidPaymentStatusFilter}`);
    this.name = 'InvalidTransactionPaymentStatusFilterError';
    this.code = 'INVALID_TRANSACTION_PAYMENT_STATUS';
  }
}

function validateTransactionMethodFilter(methodFilter) {
  if (methodFilter == null) {
    return null;
  }
  if (!TRANSACTION_METHOD_VALUES.includes(methodFilter)) {
    throw new InvalidTransactionMethodFilterError(methodFilter);
  }
  return methodFilter;
}

function validateTransactionPaymentStatusFilter(paymentStatusFilter) {
  if (paymentStatusFilter == null) {
    return null;
  }
  if (!TRANSACTION_PAYMENT_STATUS_VALUES.includes(paymentStatusFilter)) {
    throw new InvalidTransactionPaymentStatusFilterError(paymentStatusFilter);
  }
  return paymentStatusFilter;
}

const TRANSACTION_TRACKING_QUERY = `
SELECT
  b.id AS booking_id,
  b.ref AS booking_ref,
  b.full_name,
  b.phone_number,
  b.email,
  b.status AS booking_status,
  b.utm_source,
  b.created_at AS booking_created_at,
  b.expires_at AS booking_expires_at,
  p.id AS payment_id,
  p.payment_method,
  p.amount_expected,
  p.status AS payment_status,
  p.reference_id,
  p.wallet_address,
  p.tx_hash,
  p.initiated_at,
  p.confirmed_at AS payment_confirmed_at,
  p.created_at AS payment_created_at,
  p.updated_at AS payment_updated_at,
  opr.id AS offline_receipt_id,
  opr.original_file_name AS offline_receipt_original_file_name,
  opr.mime_type AS offline_receipt_mime_type,
  opr.status AS offline_receipt_status,
  opr.uploaded_at AS offline_receipt_uploaded_at,
  opr.reviewed_at AS offline_receipt_reviewed_at,
  o.id AS order_id,
  o.customer_id AS order_customer_id,
  o.status AS order_status,
  o.amount_usdt,
  o.created_at AS order_created_at,
  o.expires_at AS order_expires_at,
  da.address AS deposit_address,
  da.derivation_index,
  da.created_at AS deposit_address_created_at,
  td.status AS ticket_delivery_status,
  td.sent_at AS ticket_sent_at,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'tx_hash', d.tx_hash,
        'from_address', d.from_address,
        'amount', d.amount,
        'block_number', d.block_number,
        'confirmations', d.confirmations,
        'matched_at', d.matched_at))
      FROM deposits_observed d
      WHERE d.order_id IN (
        SELECT booking_order.id FROM orders booking_order WHERE booking_order.booking_id = b.id
      )),
    '[]'::jsonb) AS observed_deposits,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'id', wh.id,
        'payload', wh.payload,
        'received_at', wh.received_at))
      FROM payment_webhooks wh
      WHERE wh.payment_id = p.id),
    '[]'::jsonb) AS payment_webhooks,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'tx_hash', bt.tx_hash,
        'block_number', bt.block_number,
        'from_address', bt.from_address,
        'to_address', bt.to_address,
        'value', bt.value,
        'confirmed_at', bt.confirmed_at))
      FROM blockchain_transactions bt
      WHERE bt.payment_id = p.id),
    '[]'::jsonb) AS verified_transactions,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'tx_hash', bte.tx_hash,
        'error_message', bte.error_message,
        'received_at', bte.received_at))
      FROM blockchain_transaction_errors bte
      WHERE bte.payment_id = p.id),
    '[]'::jsonb) AS verification_errors,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'tx_id', az.tx_id,
        'value', az.value,
        'confirmed_at', az.confirmed_at))
      FROM azampesa az
      WHERE az.payment_id = p.id),
    '[]'::jsonb) AS azampesa_transactions,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'id', sw.id,
        'status', sw.status,
        'tx_hash', sw.tx_hash,
        'amount', sw.amount,
        'failure_reason', sw.failure_reason,
        'created_at', sw.created_at,
        'updated_at', sw.updated_at))
      FROM sweeps sw
      WHERE sw.order_id IN (
        SELECT booking_order.id FROM orders booking_order WHERE booking_order.booking_id = b.id
      )),
    '[]'::jsonb) AS sweeps,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'id', tl.id,
        'sweep_id', tl.sweep_id,
        'tx_hash', tl.tx_hash,
        'amount', tl.amount,
        'recorded_at', tl.recorded_at))
      FROM treasury_ledger tl
      WHERE tl.order_id IN (
        SELECT booking_order.id FROM orders booking_order WHERE booking_order.booking_id = b.id
      )),
    '[]'::jsonb) AS treasury_ledger_entries
FROM bookings b
JOIN payments p ON p.booking_id = b.id
-- A booking is meant to own a single deposit order, but historical rows can
-- hold several (for example an expired order plus the paid one that followed).
-- Pick one representative order so the join never duplicates a payment into
-- two transaction rows, which would break React list keys and double-count.
LEFT JOIN LATERAL (
  SELECT o.*
  FROM orders o
  WHERE o.booking_id = b.id
  ORDER BY
    CASE o.status
      WHEN 'paid' THEN 0
      WHEN 'pending' THEN 1
      WHEN 'swept' THEN 2
      ELSE 3
    END,
    o.created_at DESC
  LIMIT 1
) o ON true
-- An order can also hold superseded addresses, so show only its current one.
LEFT JOIN LATERAL (
  SELECT da.*
  FROM deposit_addresses da
  WHERE da.order_id = o.id
  ORDER BY da.is_active DESC, da.created_at DESC
  LIMIT 1
) da ON true
LEFT JOIN offline_payment_receipts opr ON opr.payment_id = p.id
LEFT JOIN ticket_deliveries td ON td.booking_id = b.id
`;

export async function fetchTransactionTrackingRecords({
  methodFilter,
  paymentStatusFilter,
} = {}) {
  const validatedMethodFilter = validateTransactionMethodFilter(methodFilter);
  const validatedPaymentStatusFilter = validateTransactionPaymentStatusFilter(paymentStatusFilter);

  const filterConditions = [];
  const queryParams = [];
  if (validatedMethodFilter) {
    queryParams.push(validatedMethodFilter);
    filterConditions.push(`p.payment_method = $${queryParams.length}`);
  }
  if (validatedPaymentStatusFilter) {
    queryParams.push(validatedPaymentStatusFilter);
    filterConditions.push(`p.status = $${queryParams.length}`);
  }
  const whereClause = filterConditions.length
    ? `WHERE ${filterConditions.join(' AND ')}`
    : '';

  const result = await pool.query(
    `${TRANSACTION_TRACKING_QUERY} ${whereClause} ORDER BY b.created_at DESC`,
    queryParams
  );

  return result.rows.map((row) => {
    const normalizedRecord = {
      ...row,
      booking_id: Number(row.booking_id),
      payment_id: Number(row.payment_id),
      order_id: row.order_id == null ? null : Number(row.order_id),
      offline_receipt_id:
        row.offline_receipt_id == null ? null : Number(row.offline_receipt_id),
      amount_expected: row.amount_expected == null ? null : Number(row.amount_expected),
      amount_usdt: row.amount_usdt == null ? null : Number(row.amount_usdt),
      observed_deposits: row.observed_deposits || [],
      payment_webhooks: row.payment_webhooks || [],
      verified_transactions: row.verified_transactions || [],
      verification_errors: row.verification_errors || [],
      azampesa_transactions: row.azampesa_transactions || [],
      sweeps: row.sweeps || [],
      treasury_ledger_entries: row.treasury_ledger_entries || [],
    };
    return {
      ...normalizedRecord,
      stages: buildTransactionStageTimeline(normalizedRecord),
    };
  });
}

const TERMINAL_PAYMENT_STATUSES = Object.freeze(['confirmed', 'failed', 'expired']);

function isPaymentStatusTerminal(paymentStatus) {
  return TERMINAL_PAYMENT_STATUSES.includes(paymentStatus);
}

function findLatestTimestamp(timestamps) {
  const parseableMilliseconds = timestamps
    .filter((timestamp) => timestamp != null && timestamp !== '')
    .map((timestamp) => new Date(timestamp).getTime());
  if (parseableMilliseconds.length === 0) {
    return null;
  }
  return new Date(Math.max(...parseableMilliseconds)).toISOString();
}

function getLatestWebhookReceivedAt(paymentWebhooks) {
  return findLatestTimestamp(paymentWebhooks.map((webhook) => webhook.received_at));
}

function getLatestDepositMatchedAt(observedDeposits) {
  return findLatestTimestamp(observedDeposits.map((deposit) => deposit.matched_at));
}

function pushStage(stages, key, label, status, at, detail) {
  stages.push({
    key,
    label,
    status,
    at: at ?? null,
    detail: detail ?? null,
  });
}

function buildAzamPesaStageTimeline(stages, transactionRecord) {
  const paymentAlreadyTerminal = isPaymentStatusTerminal(transactionRecord.payment_status);

  const stkPromptSent =
    Boolean(transactionRecord.reference_id) ||
    transactionRecord.azampesa_transactions.length > 0;

  pushStage(
    stages,
    'stk_prompt_sent',
    'AzamPesa STK prompt sent',
    stkPromptSent ? 'done' : paymentAlreadyTerminal ? 'waiting' : 'current',
    stkPromptSent ? transactionRecord.payment_updated_at : null
  );

  const hasReceivedWebhook = transactionRecord.payment_webhooks.length > 0;
  const latestWebhook = hasReceivedWebhook
    ? transactionRecord.payment_webhooks[transactionRecord.payment_webhooks.length - 1]
    : null;

  pushStage(
    stages,
    'webhook_received',
    'AzamPay webhook received',
    hasReceivedWebhook
      ? 'done'
      : stkPromptSent && !paymentAlreadyTerminal
        ? 'current'
        : 'waiting',
    getLatestWebhookReceivedAt(transactionRecord.payment_webhooks),
    latestWebhook?.payload?.transactionstatus ?? null
  );

  if (transactionRecord.payment_status === 'confirmed') {
    pushStage(
      stages,
      'payment_confirmed',
      'Payment confirmed',
      'done',
      transactionRecord.payment_confirmed_at
    );
  } else if (transactionRecord.payment_status === 'failed') {
    pushStage(
      stages,
      'payment_failed',
      'Payment failed',
      'failed',
      transactionRecord.payment_updated_at,
      latestWebhook?.payload?.transactionstatus ?? null
    );
  } else {
    pushStage(stages, 'payment_confirmed', 'Payment confirmed', 'waiting');
  }

  pushTicketDeliveryStage(stages, transactionRecord);
}

function pushTicketDeliveryStage(stages, transactionRecord) {
  const ticketDeliveryStatus = transactionRecord.ticket_delivery_status;
  pushStage(
    stages,
    'ticket_delivered',
    'Ticket emailed',
    ticketDeliveryStatus === 'sent'
      ? 'done'
      : ticketDeliveryStatus === 'failed'
        ? 'failed'
        : 'waiting',
    transactionRecord.ticket_sent_at
  );
}

function buildLipaNambaStageTimeline(stages, transactionRecord) {
  const paymentAlreadyTerminal = isPaymentStatusTerminal(transactionRecord.payment_status);
  const hasUploadedReceipt = Boolean(transactionRecord.offline_receipt_id);

  pushStage(
    stages,
    'receipt_uploaded',
    'Payment receipt uploaded',
    hasUploadedReceipt ? 'done' : paymentAlreadyTerminal ? 'waiting' : 'current',
    transactionRecord.offline_receipt_uploaded_at,
    transactionRecord.offline_receipt_original_file_name ?? null
  );

  const isReceiptApproved = transactionRecord.offline_receipt_status === 'approved';
  const isReceiptRejected = transactionRecord.offline_receipt_status === 'rejected';

  pushStage(
    stages,
    'admin_review',
    'Admin reviewed receipt',
    isReceiptApproved
      ? 'done'
      : isReceiptRejected
        ? 'failed'
        : hasUploadedReceipt && !paymentAlreadyTerminal
          ? 'current'
          : 'waiting',
    transactionRecord.offline_receipt_reviewed_at,
    transactionRecord.offline_receipt_status ?? null
  );

  if (transactionRecord.payment_status === 'confirmed') {
    pushStage(
      stages,
      'payment_confirmed',
      'Payment confirmed',
      'done',
      transactionRecord.payment_confirmed_at
    );
  } else if (transactionRecord.payment_status === 'failed') {
    pushStage(
      stages,
      'payment_failed',
      'Payment failed',
      'failed',
      transactionRecord.payment_updated_at
    );
  } else {
    pushStage(stages, 'payment_confirmed', 'Payment confirmed', 'waiting');
  }

  pushTicketDeliveryStage(stages, transactionRecord);
}

function buildUsdtStageTimeline(stages, transactionRecord) {
  const hasAssignedDepositAddress = Boolean(transactionRecord.deposit_address);

  pushStage(
    stages,
    'deposit_address_assigned',
    'Deposit address assigned',
    hasAssignedDepositAddress ? 'done' : 'waiting',
    transactionRecord.deposit_address_created_at,
    transactionRecord.deposit_address || null
  );

  const hasObservedDeposit = transactionRecord.observed_deposits.length > 0;

  pushStage(
    stages,
    'deposit_observed',
    'USDT deposit observed',
    hasObservedDeposit
      ? 'done'
      : transactionRecord.order_status === 'pending'
        ? 'current'
        : 'waiting',
    getLatestDepositMatchedAt(transactionRecord.observed_deposits),
    hasObservedDeposit
      ? `${transactionRecord.observed_deposits.length} transfer(s) tracked`
      : null
  );

  if (transactionRecord.payment_status === 'confirmed') {
    pushStage(
      stages,
      'payment_confirmed',
      'Payment confirmed',
      'done',
      transactionRecord.payment_confirmed_at
    );
  } else if (transactionRecord.verification_errors.length > 0) {
    const latestVerificationError =
      transactionRecord.verification_errors[transactionRecord.verification_errors.length - 1];
    pushStage(
      stages,
      'verification_failed',
      'Blockchain verification failed',
      'failed',
      latestVerificationError.received_at,
      latestVerificationError.error_message ?? null
    );
  } else {
    pushStage(stages, 'payment_confirmed', 'Payment confirmed', 'waiting');
  }

  const latestSweptTimestamp = findLatestTimestamp(
    transactionRecord.treasury_ledger_entries.map((ledgerEntry) => ledgerEntry.recorded_at)
  );
  const fundsSwept =
    transactionRecord.sweeps.some((sweep) => sweep.status === 'swept') ||
    transactionRecord.treasury_ledger_entries.length > 0;

  pushStage(
    stages,
    'funds_swept',
    'Funds swept to treasury',
    fundsSwept ? 'done' : 'waiting',
    latestSweptTimestamp
  );

  if (transactionRecord.order_status === 'expired') {
    const latestFailedSweep = transactionRecord.sweeps.find(
      (sweep) => sweep.status === 'failed'
    );
    pushStage(
      stages,
      'order_expired',
      'Deposit order expired',
      'failed',
      transactionRecord.order_expires_at,
      latestFailedSweep?.failure_reason ?? null
    );
  }
}

export function buildTransactionStageTimeline(transactionRecord) {
  const stages = [];

  pushStage(stages, 'booking_created', 'Booking created', 'done', transactionRecord.booking_created_at);

  pushStage(
    stages,
    'payment_created',
    'Payment record created',
    'done',
    transactionRecord.payment_created_at
  );

  if (transactionRecord.payment_method === PAYMENT_METHOD_AZAMPESA) {
    buildAzamPesaStageTimeline(stages, transactionRecord);
  } else if (transactionRecord.payment_method === PAYMENT_METHOD_LIPANAMBA) {
    buildLipaNambaStageTimeline(stages, transactionRecord);
  } else {
    buildUsdtStageTimeline(stages, transactionRecord);
  }

  return stages;
}