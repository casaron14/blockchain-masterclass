import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';
import { TICKET_PRICE_TZS } from '../services/eventConfigService.js';

import {
  buildTransactionStageTimeline,
  fetchTransactionTrackingRecords,
  InvalidTransactionMethodFilterError,
  InvalidTransactionPaymentStatusFilterError,
} from '../services/transactionTrackingService.js';

function createBaseTransactionRecord(overrides = {}) {
  return {
    booking_id: 1,
    booking_ref: 'REF001',
    full_name: 'Anna Mwangi',
    phone_number: '+255712345678',
    email: 'anna@example.com',
    booking_status: 'pending',
    utm_source: null,
    booking_created_at: '2026-09-01T10:00:00Z',
    booking_expires_at: '2026-09-01T10:15:00Z',
    payment_id: 10,
    payment_method: 'azampesa',
    amount_expected: 10000,
    payment_status: 'initiating',
    reference_id: null,
    wallet_address: null,
    tx_hash: null,
    payment_initiated_at: '2026-09-01T10:01:00Z',
    payment_confirmed_at: null,
    payment_created_at: '2026-09-01T10:01:00Z',
    payment_updated_at: '2026-09-01T10:01:00Z',
    offline_receipt_id: null,
    offline_receipt_original_file_name: null,
    offline_receipt_mime_type: null,
    offline_receipt_status: null,
    offline_receipt_uploaded_at: null,
    offline_receipt_reviewed_at: null,
    order_id: null,
    order_status: null,
    amount_usdt: null,
    order_created_at: null,
    order_expires_at: null,
    deposit_address: null,
    deposit_address_created_at: null,
    ticket_delivery_status: null,
    ticket_sent_at: null,
    observed_deposits: [],
    payment_webhooks: [],
    verified_transactions: [],
    verification_errors: [],
    azampesa_transactions: [],
    sweeps: [],
    treasury_ledger_entries: [],
    ...overrides,
  };
}

function findStageByKey(stages, stageKey) {
  return stages.find((stage) => stage.key === stageKey);
}

test('azampesa stage timeline marks STK prompt as the current stage while awaiting webhook', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_status: 'pending',
      reference_id: 'azam-external-1',
    })
  );

  assert.deepEqual(
    stages.map((stage) => stage.key),
    [
      'booking_created',
      'payment_created',
      'stk_prompt_sent',
      'webhook_received',
      'payment_confirmed',
      'ticket_delivered',
    ]
  );
  assert.equal(findStageByKey(stages, 'booking_created').status, 'done');
  assert.equal(findStageByKey(stages, 'payment_created').status, 'done');
  assert.equal(findStageByKey(stages, 'stk_prompt_sent').status, 'done');
  assert.equal(findStageByKey(stages, 'webhook_received').status, 'current');
  assert.equal(findStageByKey(stages, 'payment_confirmed').status, 'waiting');
});

test('azampesa stage timeline completes through confirmed and ticket delivery', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_status: 'confirmed',
      reference_id: 'azam-external-2',
      payment_confirmed_at: '2026-09-01T10:03:00Z',
      payment_webhooks: [
        { id: 1, payload: { transactionstatus: 'success' }, received_at: '2026-09-01T10:02:00Z' },
      ],
      azampesa_transactions: [{ tx_id: 'tx-1', value: 30000, confirmed_at: '2026-09-01T10:03:00Z' }],
      ticket_delivery_status: 'sent',
      ticket_sent_at: '2026-09-01T10:04:00Z',
    })
  );

  assert.equal(findStageByKey(stages, 'webhook_received').status, 'done');
  assert.equal(findStageByKey(stages, 'payment_confirmed').status, 'done');
  assert.equal(findStageByKey(stages, 'ticket_delivered').status, 'done');
  assert.equal(
    findStageByKey(stages, 'webhook_received').detail,
    'success'
  );
});

test('azampesa stage timeline reports a failed payment', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_status: 'failed',
      reference_id: 'azam-external-3',
      payment_webhooks: [
        { id: 2, payload: { transactionstatus: 'declined' }, received_at: '2026-09-01T10:02:00Z' },
      ],
    })
  );

  assert.equal(findStageByKey(stages, 'payment_failed').status, 'failed');
  assert.equal(findStageByKey(stages, 'payment_failed').detail, 'declined');
  assert.equal(findStageByKey(stages, 'payment_confirmed'), undefined);
});

test('lipanamba stage timeline waits for admin review after a receipt is uploaded', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_method: 'lipanamba',
      payment_status: 'pending',
      offline_receipt_id: 7,
      offline_receipt_original_file_name: 'receipt.png',
      offline_receipt_status: 'submitted',
      offline_receipt_uploaded_at: '2026-09-01T10:02:00Z',
    })
  );

  assert.deepEqual(
    stages.map((stage) => stage.key),
    [
      'booking_created',
      'payment_created',
      'receipt_uploaded',
      'admin_review',
      'payment_confirmed',
      'ticket_delivered',
    ]
  );
  assert.equal(findStageByKey(stages, 'receipt_uploaded').status, 'done');
  assert.equal(findStageByKey(stages, 'receipt_uploaded').detail, 'receipt.png');
  assert.equal(findStageByKey(stages, 'admin_review').status, 'current');
  assert.equal(findStageByKey(stages, 'payment_confirmed').status, 'waiting');
});

test('lipanamba stage timeline completes after the admin approves the receipt', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_method: 'lipanamba',
      payment_status: 'confirmed',
      payment_confirmed_at: '2026-09-01T10:05:00Z',
      offline_receipt_id: 8,
      offline_receipt_original_file_name: 'receipt.png',
      offline_receipt_status: 'approved',
      offline_receipt_uploaded_at: '2026-09-01T10:02:00Z',
      offline_receipt_reviewed_at: '2026-09-01T10:05:00Z',
      ticket_delivery_status: 'sent',
      ticket_sent_at: '2026-09-01T10:06:00Z',
    })
  );

  assert.equal(findStageByKey(stages, 'admin_review').status, 'done');
  assert.equal(findStageByKey(stages, 'payment_confirmed').status, 'done');
  assert.equal(findStageByKey(stages, 'ticket_delivered').status, 'done');
});

test('usdt stage timeline waits for a deposit against a live deposit address', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_method: 'usdt_bep20',
      payment_status: 'pending',
      order_id: 20,
      order_status: 'pending',
      amount_usdt: 12,
      order_created_at: '2026-09-01T10:01:00Z',
      order_expires_at: '2026-09-01T10:16:00Z',
      deposit_address: '0x1234567890abcdef1234567890abcdef12345678',
      deposit_address_created_at: '2026-09-01T10:01:30Z',
    })
  );

  assert.equal(findStageByKey(stages, 'deposit_address_assigned').status, 'done');
  assert.equal(findStageByKey(stages, 'deposit_observed').status, 'current');
  assert.equal(findStageByKey(stages, 'payment_confirmed').status, 'waiting');
  assert.equal(findStageByKey(stages, 'funds_swept').status, 'waiting');
});

test('usdt stage timeline completes through confirmed deposit and sweep', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_method: 'usdt_bep20',
      payment_status: 'confirmed',
      payment_confirmed_at: '2026-09-01T10:10:00Z',
      order_id: 21,
      order_status: 'paid',
      order_created_at: '2026-09-01T10:01:00Z',
      order_expires_at: '2026-09-01T10:16:00Z',
      deposit_address: '0xabcdef1234567890abcdef1234567890abcdef12',
      deposit_address_created_at: '2026-09-01T10:01:30Z',
      observed_deposits: [
        {
          tx_hash: '0xdeposit1',
          from_address: '0xfrom1',
          amount: 12,
          block_number: 2100,
          confirmations: 3,
          matched_at: '2026-09-01T10:05:00Z',
        },
      ],
      verified_transactions: [
        {
          tx_hash: '0xdeposit1',
          block_number: 2100,
          from_address: '0xfrom1',
          to_address: '0xabcdef1234567890abcdef1234567890abcdef12',
          value: 12,
          confirmed_at: '2026-09-01T10:10:00Z',
        },
      ],
      sweeps: [
        {
          id: 1,
          status: 'swept',
          tx_hash: '0xswitch1',
          amount: 12,
          failure_reason: null,
          created_at: '2026-09-01T10:20:00Z',
          updated_at: '2026-09-01T10:21:00Z',
        },
      ],
      treasury_ledger_entries: [
        {
          id: 1,
          sweep_id: 1,
          tx_hash: '0xswitch1',
          amount: 12,
          recorded_at: '2026-09-01T10:21:00Z',
        },
      ],
    })
  );

  assert.equal(findStageByKey(stages, 'deposit_observed').status, 'done');
  assert.equal(findStageByKey(stages, 'payment_confirmed').status, 'done');
  assert.equal(findStageByKey(stages, 'funds_swept').status, 'done');
});

test('usdt stage timeline reports blockchain verification errors', () => {
  const stages = buildTransactionStageTimeline(
    createBaseTransactionRecord({
      payment_method: 'usdt_bep20',
      payment_status: 'pending',
      order_id: 22,
      order_status: 'pending',
      amount_usdt: 12,
      deposit_address: '0xabcdef1234567890abcdef1234567890abcdef12',
      deposit_address_created_at: '2026-09-01T10:01:30Z',
      verification_errors: [
        {
          id: 1,
          tx_hash: '0xbadhash',
          error_message: 'USDT amount mismatch',
          received_at: '2026-09-01T10:06:00Z',
        },
      ],
    })
  );

  assert.equal(findStageByKey(stages, 'verification_failed').status, 'failed');
  assert.equal(findStageByKey(stages, 'verification_failed').detail, 'USDT amount mismatch');
});

test('fetchTransactionTrackingRecords rejects an invalid method filter', async () => {
  await assert.rejects(
    () => fetchTransactionTrackingRecords({ methodFilter: 'bitcoin' }),
    (error) => error instanceof InvalidTransactionMethodFilterError
  );
});

test('fetchTransactionTrackingRecords rejects an invalid payment status filter', async () => {
  await assert.rejects(
    () => fetchTransactionTrackingRecords({ paymentStatusFilter: 'paid' }),
    (error) => error instanceof InvalidTransactionPaymentStatusFilterError
  );
});

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

async function createAzamPesaTransactionFixture() {
  const createdBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Tracked Attendee',
    email: 'tracked@example.com',
    phone_number: '+255712345698',
  });

  // AzamPesa is retired for new payments; the tracking view must still read the
  // historical rows an older deployment created, so the fixture writes one
  // directly instead of going through the (now guarded) creation path.
  const createdPaymentResult = await pool.query(
    `INSERT INTO payments (booking_id, payment_method, amount_expected, status)
     VALUES ($1, 'azampesa', $2, 'pending')
     RETURNING *`,
    [createdBooking.id, TICKET_PRICE_TZS]
  );
  const createdPayment = createdPaymentResult.rows[0];

  await pool.query(
    `UPDATE payments
        SET reference_id = 'azam-fixture-external',
            status = 'pending'
      WHERE id = $1`,
    [createdPayment.id]
  );

  await pool.query(
    `INSERT INTO payment_webhooks (payment_id, payload)
     VALUES ($1, $2)`,
    [createdPayment.id, JSON.stringify({ utilityref: 'azam-fixture-external', transactionstatus: 'success' })]
  );

  return { createdBooking, createdPayment };
}

beforeEach(resetDatabaseState);

test('fetchTransactionTrackingRecords returns a staged azampesa transaction with attendee details', async () => {
  const { createdBooking, createdPayment } = await createAzamPesaTransactionFixture();

  const transactions = await fetchTransactionTrackingRecords({ methodFilter: 'azampesa' });

  const matchedTransaction = transactions.find(
    (transaction) => transaction.payment_id === Number(createdPayment.id)
  );

  assert.ok(matchedTransaction, 'expected the created transaction to be listed');
  assert.equal(matchedTransaction.payment_method, 'azampesa');
  assert.equal(matchedTransaction.booking_ref, createdBooking.ref);
  assert.equal(matchedTransaction.full_name, 'Tracked Attendee');
  assert.equal(matchedTransaction.phone_number, '+255712345698');
  assert.equal(matchedTransaction.email, 'tracked@example.com');
  assert.equal(matchedTransaction.payment_webhooks.length, 1);
  assert.equal(matchedTransaction.azampesa_transactions.length, 0);

  const stageKeys = matchedTransaction.stages.map((stage) => stage.key);
  assert.deepEqual(stageKeys, [
    'booking_created',
    'payment_created',
    'stk_prompt_sent',
    'webhook_received',
    'payment_confirmed',
    'ticket_delivered',
  ]);
  assert.equal(
    matchedTransaction.stages.find((stage) => stage.key === 'webhook_received').status,
    'done'
  );
});

test('fetchTransactionTrackingRecords returns one row per payment when a booking has several deposit orders', async () => {
  const createdBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Duplicate Order Attendee',
    email: 'duplicate-orders@example.com',
    phone_number: '+255712345699',
  });

  const createdPayment = await createPendingPaymentRecordForBooking(
    createdBooking.id,
    'usdt_bep20'
  );

  const paidOrder = await createOrderWithDepositAddressForBooking(createdBooking.id);
  await pool.query("UPDATE orders SET status = 'paid' WHERE id = $1", [paidOrder.id]);

  const expiredOrderResult = await pool.query(
    `INSERT INTO orders (booking_id, amount_usdt, status, expires_at)
     VALUES ($1, 3.80, 'expired', now() - INTERVAL '1 minute')
     RETURNING id`,
    [createdBooking.id]
  );
  const expiredOrderId = Number(expiredOrderResult.rows[0].id);

  await pool.query(
    `INSERT INTO deposit_addresses (order_id, derivation_index, address, is_active, superseded_at)
     VALUES ($1, 900001, $2, false, now())`,
    [expiredOrderId, `0x${'1'.repeat(40)}`]
  );

  // A superseded address belongs to the same order but must not multiply rows.
  await pool.query(
    `INSERT INTO deposit_addresses (order_id, derivation_index, address, is_active, superseded_at)
     VALUES ($1, 900002, $2, false, now())`,
    [paidOrder.id, `0x${'2'.repeat(40)}`]
  );

  const transactions = await fetchTransactionTrackingRecords({ methodFilter: 'usdt_bep20' });
  const matchingTransactionRows = transactions.filter(
    (transaction) => transaction.payment_id === Number(createdPayment.id)
  );

  assert.equal(
    matchingTransactionRows.length,
    1,
    'a payment with several orders must produce exactly one transaction row'
  );

  const listedPaymentIds = transactions.map((transaction) => transaction.payment_id);
  assert.equal(
    new Set(listedPaymentIds).size,
    listedPaymentIds.length,
    'transaction payment ids must be unique so React list keys stay stable'
  );

  assert.equal(matchingTransactionRows[0].order_id, paidOrder.id);
  assert.equal(matchingTransactionRows[0].order_status, 'paid');
  assert.equal(matchingTransactionRows[0].deposit_address, paidOrder.deposit_address);
});