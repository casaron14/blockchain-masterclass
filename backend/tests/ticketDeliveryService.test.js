import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'fs';
import pool from '../config/db.js';

import {
  buildTicketQrPayload,
  renderTicketQrDataUrl,
  deliverTicketForConfirmedBooking,
  redeliverFailedTicketEmail,
  sendTicketEmailToAttendee,
} from '../services/ticketDeliveryService.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
} from '../services/bookingService.js';

import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';

import {
  createPaymentReceiptRecordForConfirmedPayment,
  fetchPaymentReceiptByBookingId,
} from '../services/paymentReceiptService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createConfirmedBooking() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Ticket User',
    email: 'ticket@example.com',
    phone_number: '+255712345694',
  });
  const confirmedBooking = await confirmBookingSeatWithinCapacity(bookingRecord.id);
  return confirmedBooking;
}

async function createPendingPaymentReceiptForBooking(bookingId) {
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingId,
    'usdt_bep20'
  );
  await pool.query(
    `UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
    [paymentRecord.id]
  );

  const orderCreation = await createOrderWithDepositAddressForBooking(bookingId);
  const bookingRecord = await pool.query('SELECT * FROM bookings WHERE id = $1', [
    bookingId,
  ]);
  const orderRecord = await pool.query('SELECT * FROM orders WHERE id = $1', [
    orderCreation.id,
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receiptRecord = await createPaymentReceiptRecordForConfirmedPayment({
      client,
      paymentRecord: { ...paymentRecord, status: 'confirmed' },
      bookingRecord: bookingRecord.rows[0],
      orderRecord: orderRecord.rows[0],
      depositAddress: orderCreation.deposit_address,
      observedDeposits: [
        {
          tx_hash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          from_address: '0x3333333333333333333333333333333333333333',
          amount: '3.80',
          amount_wei: '3800000000000000000',
          block_number: 300,
          block_hash: '0xblockhash300',
        },
      ],
      settlementSummary: {
        finalizedBlockNumber: 310,
        confirmationsAtIssue: 11,
        chainId: 56,
      },
    });
    await client.query('COMMIT');
    return receiptRecord;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fetchDeliveryRecordForBooking(bookingId) {
  const result = await pool.query('SELECT * FROM ticket_deliveries WHERE booking_id = $1', [
    bookingId,
  ]);
  return result.rows[0] ?? null;
}

test('buildTicketQrPayload includes attendee and event details', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const qrPayload = buildTicketQrPayload(confirmedBooking);

  assert.equal(qrPayload.bookingReference, confirmedBooking.ref);
  assert.equal(qrPayload.attendeeName, 'Ticket User');
  assert.equal(qrPayload.bookingId, confirmedBooking.id);
  assert.ok(qrPayload.ticketId.startsWith('EVT-'));
  assert.ok(qrPayload.eventTitle.length > 0);
});

test('renderTicketQrDataUrl returns a valid PNG data URL', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const qrDataUrl = await renderTicketQrDataUrl(confirmedBooking);
  assert.match(qrDataUrl, /^data:image\/png;base64,/);
});

test('deliverTicketForConfirmedBooking records a sent delivery on success', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const stubSender = async () => ({ ok: true });

  const result = await deliverTicketForConfirmedBooking(confirmedBooking.id, stubSender);

  assert.equal(result.delivered, true);
  assert.equal(result.bookingId, confirmedBooking.id);

  const deliveryRecord = await fetchDeliveryRecordForBooking(confirmedBooking.id);
  assert.ok(deliveryRecord);
  assert.equal(deliveryRecord.status, 'sent');
  assert.ok(deliveryRecord.sent_at);
  assert.equal(deliveryRecord.attempt_count, 1);
  assert.ok(deliveryRecord.qr_payload);
});

test('deliverTicketForConfirmedBooking records a failed delivery with a reason', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const failingSender = async () => {
    throw new Error('SMTP refused connection');
  };

  const result = await deliverTicketForConfirmedBooking(confirmedBooking.id, failingSender);

  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'SMTP refused connection');

  const deliveryRecord = await fetchDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(deliveryRecord.status, 'failed');
  assert.equal(deliveryRecord.last_error, 'SMTP refused connection');
  assert.equal(deliveryRecord.attempt_count, 1);
});

test('redeliverFailedTicketEmail flips a failed delivery to sent', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const failingSender = async () => {
    throw new Error('SMTP refused connection');
  };

  await deliverTicketForConfirmedBooking(confirmedBooking.id, failingSender);
  const failedDelivery = await fetchDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(failedDelivery.status, 'failed');

  const stubSender = async () => ({ ok: true });
  const result = await redeliverFailedTicketEmail(confirmedBooking.id, stubSender);

  assert.equal(result.delivered, true);
  const redelivered = await fetchDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(redelivered.status, 'sent');
  assert.equal(redelivered.last_error, null);
  assert.equal(redelivered.attempt_count, 2);
});

test('sendTicketEmailToAttendee attaches the ticket PDF and any receipt PDF to the email', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const sentMessages = [];
  const recordingTransport = {
    async sendMail(message) {
      sentMessages.push(message);
      return { accepted: [message.to] };
    },
  };
  const receiptPdfBuffer = Buffer.from('%PDF-1.4 fake receipt');

  await sendTicketEmailToAttendee(confirmedBooking, {
    transport: recordingTransport,
    receiptPdfArtifact: {
      fileName: `blockchain-masterclass-receipt-${confirmedBooking.ref}.pdf`,
      pdfBuffer: receiptPdfBuffer,
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, confirmedBooking.email);
  assert.match(sentMessages[0].html, /^data:image\/png;base64,|.*base64,/s);
  assert.equal(sentMessages[0].attachments.length, 2);

  const ticketAttachment = sentMessages[0].attachments[0];
  assert.equal(ticketAttachment.filename, `ticket-${confirmedBooking.ref}.pdf`);
  assert.equal(ticketAttachment.contentType, 'application/pdf');
  assert.ok(Buffer.isBuffer(ticketAttachment.content));
  assert.equal(ticketAttachment.content.subarray(0, 5).toString(), '%PDF-');

  const receiptAttachment = sentMessages[0].attachments[1];
  assert.equal(
    receiptAttachment.filename,
    `blockchain-masterclass-receipt-${confirmedBooking.ref}.pdf`
  );
  assert.ok(Buffer.isBuffer(receiptAttachment.content));
  assert.equal(receiptAttachment.content.subarray(0, 5).toString(), '%PDF-');
});

test('sendTicketEmailToAttendee attaches only the ticket PDF when no receipt exists', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const sentMessages = [];
  const recordingTransport = {
    async sendMail(message) {
      sentMessages.push(message);
      return { accepted: [message.to] };
    },
  };

  await sendTicketEmailToAttendee(confirmedBooking, { transport: recordingTransport });

  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].filename, `ticket-${confirmedBooking.ref}.pdf`);
});

test('deliverTicketForConfirmedBooking sends the receipt email after the ticket when a receipt is given', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const receiptRecord = await createPendingPaymentReceiptForBooking(
    confirmedBooking.id
  );
  const stubTicketSender = async () => ({ ok: true });
  const receiptDeliveries = [];

  const deliveryResult = await deliverTicketForConfirmedBooking(
    confirmedBooking.id,
    stubTicketSender,
    {
      receiptRecord,
      deliverReceiptEmail: async (bookingId, options) => {
        receiptDeliveries.push({ bookingId, filePath: options.filePath });
        return { delivered: true, receiptId: options.receiptRecord.id };
      },
    }
  );

  assert.equal(deliveryResult.delivered, true);
  assert.equal(deliveryResult.receipt.delivered, true);
  assert.equal(receiptDeliveries.length, 1);
  assert.equal(receiptDeliveries[0].bookingId, confirmedBooking.id);
  assert.ok(
    receiptDeliveries[0].filePath.endsWith(
      `blockchain-masterclass-receipt-${confirmedBooking.ref}.pdf`
    )
  );
  assert.equal(
    fsSync.existsSync(receiptDeliveries[0].filePath),
    true,
    'the receipt PDF is produced before the ticket email goes out'
  );

  fsSync.rmSync(receiptDeliveries[0].filePath, { force: true });

  const receiptAfterDelivery = await fetchPaymentReceiptByBookingId(confirmedBooking.id);
  assert.equal(receiptAfterDelivery.status, 'pending');
  assert.equal(
    receiptRecord.id,
    receiptAfterDelivery.id,
    'the stubbed receipt email does not mark the receipt issued'
  );
});

test('deliverTicketForConfirmedBooking keeps working when there is no receipt at all', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const stubSender = async () => ({ ok: true });

  const deliveryResult = await deliverTicketForConfirmedBooking(
    confirmedBooking.id,
    stubSender
  );

  assert.equal(deliveryResult.delivered, true);
  assert.equal(deliveryResult.receipt, null);

  const deliveryRecord = await fetchDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(deliveryRecord.status, 'sent');
});

test('deliverTicketForConfirmedBooking skips a booking that is not confirmed', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Pending User',
    email: 'pending@example.com',
    phone_number: '+255712345695',
  });

  const result = await deliverTicketForConfirmedBooking(bookingRecord.id, async () => ({ ok: true }));

  assert.equal(result.skipped, true);
  const deliveryRecord = await fetchDeliveryRecordForBooking(bookingRecord.id);
  assert.equal(deliveryRecord, null);
});
