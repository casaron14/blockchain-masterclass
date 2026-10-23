import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking, fetchPaymentRecordByBookingId } from '../services/paymentService.js';
import {
  createOrderWithDepositAddressForBooking,
  reissueDepositAddressForOrder,
  fetchDepositAddressRecordsForOrderId,
  OrderAddressAlreadyFundedError,
} from '../services/orderService.js';
import { confirmUsdtOrderPaymentFromObservedDeposits } from '../services/usdtPaymentService.js';
import { fetchPaymentReceiptByBookingId } from '../services/paymentReceiptService.js';
import { DEFAULT_USDT_DECIMALS } from '../services/usdtPaymentService.js';
import { TICKET_PRICE_USDT } from '../services/eventConfigService.js';

const PAYER_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const SETTLEMENT_FRONTIER = {
  latestBlockNumber: 1000,
  finalizedBlockNumber: 1000,
  settledBy: 'finalized',
};

function buildObservedDeposit({ depositAddressRecord, orderId, amountUsdt, blockNumber, txHash }) {
  return {
    id: depositAddressRecord.depositRecordId,
    order_id: orderId,
    amount: Number(amountUsdt),
    amount_usdt: String(amountUsdt),
    amount_wei: ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
    block_number: blockNumber,
    block_hash: `0xblock${blockNumber}`,
    tx_hash: txHash,
    from_address: PAYER_ADDRESS,
    address: depositAddressRecord.address,
    is_finalized: false,
  };
}

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

async function createPendingCryptoBooking({ ticketPriceUsdt } = {}) {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Confirmation Test Attendee',
    email: `confirm-${Date.now()}-${Math.random()}@example.com`,
    phone_number: '+255712345222',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);
  const depositAddressRecords = await fetchDepositAddressRecordsForOrderId(createdOrder.id);
  const activeDepositAddress = depositAddressRecords.find((record) => record.is_active);

  return { bookingRecord, paymentRecord, createdOrder, activeDepositAddress };
}

async function recordObservedDeposit({ depositAddressRecord, orderId, amountUsdt, blockNumber, txHash }) {
  const insertResult = await pool.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id, confirmations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     RETURNING id`,
    [
      depositAddressRecord.address,
      txHash,
      PAYER_ADDRESS,
      amountUsdt,
      ethers.parseUnits(String(amountUsdt), DEFAULT_USDT_DECIMALS).toString(),
      blockNumber,
      `0xblock${blockNumber}`,
      orderId,
    ]
  );
  return Number(insertResult.rows[0].id);
}

function buildSuccessfulDeliveryStub() {
  return async () => ({ delivered: true, receipt: { delivered: true } });
}

beforeEach(resetDatabaseState);

test('a settled complete payment writes every record in one transaction and issues a receipt', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
  const depositRecordId = await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: TICKET_PRICE_USDT,
    blockNumber: 990,
    txHash: '0xcompletesettlement',
  });
  const observedDeposits = [
    buildObservedDeposit({
      depositAddressRecord: activeDepositAddress,
      orderId: createdOrder.id,
      amountUsdt: TICKET_PRICE_USDT,
      blockNumber: 990,
      txHash: '0xcompletesettlement',
    }),
  ];
  observedDeposits[0].id = depositRecordId;

  const confirmationResult = await confirmUsdtOrderPaymentFromObservedDeposits({
    orderId: createdOrder.id,
    bookingId: bookingRecord.id,
    paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
    depositAddress: activeDepositAddress.address,
    observedDeposits,
    settlementFrontier: SETTLEMENT_FRONTIER,
    chainId: 97,
    deliverTicket: buildSuccessfulDeliveryStub(),
    deliverReceiptEmail: buildSuccessfulDeliveryStub(),
  });

  assert.equal(confirmationResult.confirmed, true);
  assert.equal(confirmationResult.seatConfirmed, true);
  assert.equal(confirmationResult.txHash, '0xcompletesettlement');

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(paymentRecord.status, 'confirmed');
  assert.equal(paymentRecord.tx_hash, '0xcompletesettlement');
  assert.ok(paymentRecord.confirmed_at, 'confirmed_at is set by the confirmation');

  const bookingStatusResult = await pool.query('SELECT status FROM bookings WHERE id = $1', [
    bookingRecord.id,
  ]);
  assert.equal(bookingStatusResult.rows[0].status, 'confirmed');

  const orderStatusResult = await pool.query('SELECT status FROM orders WHERE id = $1', [
    createdOrder.id,
  ]);
  assert.equal(orderStatusResult.rows[0].status, 'paid');

  const blockchainTransactionResult = await pool.query(
    'SELECT * FROM blockchain_transactions WHERE tx_hash = $1',
    ['0xcompletesettlement']
  );
  assert.equal(blockchainTransactionResult.rows.length, 1);
  assert.equal(Number(blockchainTransactionResult.rows[0].block_number), 990);

  const observedDepositResult = await pool.query(
    'SELECT is_finalized, finalized_block_number FROM deposits_observed WHERE id = $1',
    [depositRecordId]
  );
  assert.equal(observedDepositResult.rows[0].is_finalized, true);
  assert.equal(Number(observedDepositResult.rows[0].finalized_block_number), 1000);

  const receiptRecord = await fetchPaymentReceiptByBookingId(bookingRecord.id);
  assert.ok(receiptRecord, 'a receipt row exists for the confirmed payment');
  assert.equal(receiptRecord.txHash, '0xcompletesettlement');
  assert.equal(receiptRecord.status, 'pending');
  assert.equal(receiptRecord.finalizedBlockNumber, 1000);
  assert.match(receiptRecord.explorerTxUrl, /testnet\.bscscan\.com\/tx\//);
});

test('an incomplete payment is not confirmed and leaves no receipt behind', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
  const depositRecordId = await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: 1.5,
    blockNumber: 990,
    txHash: '0xunderpaid',
  });
  const observedDeposits = [
    {
      ...buildObservedDeposit({
        depositAddressRecord: activeDepositAddress,
        orderId: createdOrder.id,
        amountUsdt: 1.5,
        blockNumber: 990,
        txHash: '0xunderpaid',
      }),
      id: depositRecordId,
    },
  ];

  const confirmationResult = await confirmUsdtOrderPaymentFromObservedDeposits({
    orderId: createdOrder.id,
    bookingId: bookingRecord.id,
    paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
    depositAddress: activeDepositAddress.address,
    observedDeposits,
    settlementFrontier: SETTLEMENT_FRONTIER,
    chainId: 97,
    deliverTicket: buildSuccessfulDeliveryStub(),
    deliverReceiptEmail: buildSuccessfulDeliveryStub(),
  });

  assert.equal(confirmationResult.confirmed, false);
  assert.equal(confirmationResult.reason, 'AMOUNT_UNDERPAID');

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(paymentRecord.status, 'pending');
  assert.equal(await fetchPaymentReceiptByBookingId(bookingRecord.id), null);
});

test('a payment that is not yet settled by the chain is not confirmed', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
  const depositRecordId = await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: TICKET_PRICE_USDT,
    blockNumber: 1000,
    txHash: '0xunsettled',
  });
  const observedDeposits = [
    {
      ...buildObservedDeposit({
        depositAddressRecord: activeDepositAddress,
        orderId: createdOrder.id,
        amountUsdt: TICKET_PRICE_USDT,
        blockNumber: 1000,
        txHash: '0xunsettled',
      }),
      id: depositRecordId,
    },
  ];

  const confirmationResult = await confirmUsdtOrderPaymentFromObservedDeposits({
    orderId: createdOrder.id,
    bookingId: bookingRecord.id,
    paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
    depositAddress: activeDepositAddress.address,
    observedDeposits,
    settlementFrontier: { latestBlockNumber: 1000, finalizedBlockNumber: 995, settledBy: 'finalized' },
    chainId: 97,
    deliverTicket: buildSuccessfulDeliveryStub(),
    deliverReceiptEmail: buildSuccessfulDeliveryStub(),
  });

  assert.equal(confirmationResult.confirmed, false);
  assert.equal(confirmationResult.reason, 'NOT_FINALIZED_YET');
  assert.equal((await fetchPaymentRecordByBookingId(bookingRecord.id)).status, 'pending');
});

test('confirming twice is a no-op instead of a thrown error', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
  const depositRecordId = await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: TICKET_PRICE_USDT,
    blockNumber: 990,
    txHash: '0xidempotent',
  });
  const observedDeposits = [
    {
      ...buildObservedDeposit({
        depositAddressRecord: activeDepositAddress,
        orderId: createdOrder.id,
        amountUsdt: TICKET_PRICE_USDT,
        blockNumber: 990,
        txHash: '0xidempotent',
      }),
      id: depositRecordId,
    },
  ];
  const confirmationArguments = {
    orderId: createdOrder.id,
    bookingId: bookingRecord.id,
    paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
    depositAddress: activeDepositAddress.address,
    observedDeposits,
    settlementFrontier: SETTLEMENT_FRONTIER,
    chainId: 97,
    deliverTicket: buildSuccessfulDeliveryStub(),
    deliverReceiptEmail: buildSuccessfulDeliveryStub(),
  };

  const firstConfirmation = await confirmUsdtOrderPaymentFromObservedDeposits(confirmationArguments);
  const secondConfirmation = await confirmUsdtOrderPaymentFromObservedDeposits(confirmationArguments);

  assert.equal(firstConfirmation.confirmed, true);
  assert.equal(secondConfirmation.confirmed, true);
  assert.equal(secondConfirmation.alreadyConfirmed, true);

  const receiptCountResult = await pool.query(
    'SELECT count(*)::INT AS receipt_count FROM payment_receipts WHERE booking_id = $1',
    [bookingRecord.id]
  );
  assert.equal(receiptCountResult.rows[0].receipt_count, 1);

  const transactionCountResult = await pool.query(
    'SELECT count(*)::INT AS transaction_count FROM blockchain_transactions WHERE tx_hash = $1',
    ['0xidempotent']
  );
  assert.equal(transactionCountResult.rows[0].transaction_count, 1);
});

test('the last remaining seat can be confirmed by the hold that is taking it', async () => {
  const capacityResult = await pool.query('SELECT cap FROM seat_capacity WHERE id = 1');
  const eventCapacity = Number(capacityResult.rows[0].cap);
  await pool.query('UPDATE seat_capacity SET cap = $1 WHERE id = 1', [1]);

  try {
    const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
    const depositRecordId = await recordObservedDeposit({
      depositAddressRecord: activeDepositAddress,
      orderId: createdOrder.id,
      amountUsdt: TICKET_PRICE_USDT,
      blockNumber: 990,
      txHash: '0xlastseat',
    });
    const observedDeposits = [
      {
        ...buildObservedDeposit({
          depositAddressRecord: activeDepositAddress,
          orderId: createdOrder.id,
          amountUsdt: TICKET_PRICE_USDT,
          blockNumber: 990,
          txHash: '0xlastseat',
        }),
        id: depositRecordId,
      },
    ];

    const confirmationResult = await confirmUsdtOrderPaymentFromObservedDeposits({
      orderId: createdOrder.id,
      bookingId: bookingRecord.id,
      paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
      depositAddress: activeDepositAddress.address,
      observedDeposits,
      settlementFrontier: SETTLEMENT_FRONTIER,
      chainId: 97,
      deliverTicket: buildSuccessfulDeliveryStub(),
      deliverReceiptEmail: buildSuccessfulDeliveryStub(),
    });

    assert.equal(confirmationResult.confirmed, true);
    assert.equal(confirmationResult.seatConfirmed, true);
    assert.equal((await fetchPaymentRecordByBookingId(bookingRecord.id)).status, 'confirmed');
  } finally {
    await pool.query('UPDATE seat_capacity SET cap = $1 WHERE id = 1', [eventCapacity]);
  }
});

test('money that arrives with no seat left is still recorded and opened for refund', async () => {
  const capacityResult = await pool.query('SELECT cap FROM seat_capacity WHERE id = 1');
  const eventCapacity = Number(capacityResult.rows[0].cap);
  await pool.query('UPDATE seat_capacity SET cap = $1 WHERE id = 1', [2]);

  try {
    const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();
    const secondBooking = await createBookingRecordWithActiveSeatHold({
      full_name: 'Sold Out Attendee',
      email: `soldout-${Date.now()}@example.com`,
      phone_number: '+255712345333',
    });
    await createPendingPaymentRecordForBooking(secondBooking.id, 'usdt_bep20');
    const secondOrder = await createOrderWithDepositAddressForBooking(secondBooking.id);
    const secondDepositAddresses = await fetchDepositAddressRecordsForOrderId(secondOrder.id);
    const secondDepositAddress = secondDepositAddresses.find((record) => record.is_active);

    // The first booking takes a seat, then the event is sold out from under the
    // second booking before its payment is processed.
    await pool.query('UPDATE seat_capacity SET cap = $1 WHERE id = 1', [1]);
    await pool.query('UPDATE seat_capacity SET confirmed_count = 1 WHERE id = 1');
    await pool.query("UPDATE bookings SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1", [secondBooking.id]);

    const firstDepositRecordId = await recordObservedDeposit({
      depositAddressRecord: activeDepositAddress,
      orderId: createdOrder.id,
      amountUsdt: TICKET_PRICE_USDT,
      blockNumber: 990,
      txHash: '0xtakeslastseat',
    });
    await confirmUsdtOrderPaymentFromObservedDeposits({
      orderId: createdOrder.id,
      bookingId: bookingRecord.id,
      paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
      depositAddress: activeDepositAddress.address,
      observedDeposits: [
        {
          ...buildObservedDeposit({
            depositAddressRecord: activeDepositAddress,
            orderId: createdOrder.id,
            amountUsdt: TICKET_PRICE_USDT,
            blockNumber: 990,
            txHash: '0xtakeslastseat',
          }),
          id: firstDepositRecordId,
        },
      ],
      settlementFrontier: SETTLEMENT_FRONTIER,
      chainId: 97,
      deliverTicket: buildSuccessfulDeliveryStub(),
      deliverReceiptEmail: buildSuccessfulDeliveryStub(),
    });

    const secondDepositRecordId = await recordObservedDeposit({
      depositAddressRecord: secondDepositAddress,
      orderId: secondOrder.id,
      amountUsdt: TICKET_PRICE_USDT,
      blockNumber: 995,
      txHash: '0xarrivesafterlastseat',
    });
    const soldOutConfirmation = await confirmUsdtOrderPaymentFromObservedDeposits({
      orderId: secondOrder.id,
      bookingId: secondBooking.id,
      paymentId: (await fetchPaymentRecordByBookingId(secondBooking.id)).id,
      depositAddress: secondDepositAddress.address,
      observedDeposits: [
        {
          ...buildObservedDeposit({
            depositAddressRecord: secondDepositAddress,
            orderId: secondOrder.id,
            amountUsdt: TICKET_PRICE_USDT,
            blockNumber: 995,
            txHash: '0xarrivesafterlastseat',
          }),
          id: secondDepositRecordId,
        },
      ],
      settlementFrontier: SETTLEMENT_FRONTIER,
      chainId: 97,
      deliverTicket: buildSuccessfulDeliveryStub(),
      deliverReceiptEmail: buildSuccessfulDeliveryStub(),
    });

    assert.equal(soldOutConfirmation.confirmed, true, 'the received money is still recorded');
    assert.equal(soldOutConfirmation.seatConfirmed, false);
    assert.equal(soldOutConfirmation.requiresRefund, true);
    assert.equal((await fetchPaymentRecordByBookingId(secondBooking.id)).status, 'confirmed');

    const reviewFlagResult = await pool.query(
      'SELECT reason, auto_action, amount FROM payment_review_flags WHERE booking_id = $1',
      [secondBooking.id]
    );
    assert.equal(reviewFlagResult.rows.length, 1);
    assert.equal(reviewFlagResult.rows[0].reason, 'hold_expired_no_seat');
    assert.equal(reviewFlagResult.rows[0].auto_action, 'payment_confirmed_without_seat');
    assert.equal(Number(reviewFlagResult.rows[0].amount), TICKET_PRICE_USDT);
  } finally {
    await pool.query('UPDATE seat_capacity SET cap = $1 WHERE id = 1', [eventCapacity]);
  }
});

test('a payment to a lapsed order is still settled when a seat is free', async () => {
  const { bookingRecord, createdOrder, activeDepositAddress } = await createPendingCryptoBooking();

  await pool.query(
    `UPDATE orders SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [createdOrder.id]
  );
  await pool.query(
    `UPDATE bookings SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [bookingRecord.id]
  );

  const depositRecordId = await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: TICKET_PRICE_USDT,
    blockNumber: 990,
    txHash: '0xlatepayer',
  });

  const confirmationResult = await confirmUsdtOrderPaymentFromObservedDeposits({
    orderId: createdOrder.id,
    bookingId: bookingRecord.id,
    paymentId: (await fetchPaymentRecordByBookingId(bookingRecord.id)).id,
    depositAddress: activeDepositAddress.address,
    observedDeposits: [
      {
        ...buildObservedDeposit({
          depositAddressRecord: activeDepositAddress,
          orderId: createdOrder.id,
          amountUsdt: TICKET_PRICE_USDT,
          blockNumber: 990,
          txHash: '0xlatepayer',
        }),
        id: depositRecordId,
      },
    ],
    settlementFrontier: SETTLEMENT_FRONTIER,
    chainId: 97,
    deliverTicket: buildSuccessfulDeliveryStub(),
    deliverReceiptEmail: buildSuccessfulDeliveryStub(),
  });

  assert.equal(confirmationResult.confirmed, true);
  assert.equal(confirmationResult.seatConfirmed, true);
  assert.equal((await fetchPaymentRecordByBookingId(bookingRecord.id)).status, 'confirmed');
  assert.ok(await fetchPaymentReceiptByBookingId(bookingRecord.id));
});

test('a lapsed hold is given a fresh address while the old one stays on record', async () => {
  const { createdOrder, activeDepositAddress } = await createPendingCryptoBooking();

  await pool.query(
    `UPDATE orders SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [createdOrder.id]
  );

  const renewedOrder = await reissueDepositAddressForOrder(createdOrder.id);
  const depositAddressRecords = await fetchDepositAddressRecordsForOrderId(createdOrder.id);

  assert.notEqual(renewedOrder.deposit_address, activeDepositAddress.address);
  assert.equal(renewedOrder.status, 'pending');
  assert.ok(new Date(renewedOrder.expires_at) > new Date(), 'the hold window is renewed');

  const supersededRecord = depositAddressRecords.find(
    (record) => record.address === activeDepositAddress.address
  );
  const renewedRecord = depositAddressRecords.find((record) => record.is_active);

  assert.equal(supersededRecord.is_active, false, 'the old address is superseded, not deleted');
  assert.ok(supersededRecord.superseded_at, 'the supersession is timestamped');
  assert.equal(renewedRecord.address, renewedOrder.deposit_address);
  assert.equal(depositAddressRecords.filter((record) => record.is_active).length, 1);
});

test('an address is not reissued once money has arrived on it', async () => {
  const { createdOrder, activeDepositAddress } = await createPendingCryptoBooking();

  await pool.query(
    `UPDATE orders SET status = 'expired', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [createdOrder.id]
  );
  await recordObservedDeposit({
    depositAddressRecord: activeDepositAddress,
    orderId: createdOrder.id,
    amountUsdt: TICKET_PRICE_USDT,
    blockNumber: 990,
    txHash: '0xalreadyreceived',
  });

  await assert.rejects(
    () => reissueDepositAddressForOrder(createdOrder.id),
    (error) => error instanceof OrderAddressAlreadyFundedError
  );
});
