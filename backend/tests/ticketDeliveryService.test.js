import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'fs';
import pool from '../config/db.js';

import {
  buildTicketEmailDeliveryFailureMessage,
  deliverTicketForConfirmedBooking,
  redeliverFailedTicketEmail,
  sendTicketEmailToAttendee,
  TICKET_EMAIL_ALREADY_SENT_REASON,
  TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON,
  TICKET_EMAIL_DELIVERY_DISABLED_REASON,
} from '../services/ticketDeliveryService.js';

import { buildTicketQrCodeUrl } from '../services/ticketQrCodeService.js';

import {
  createBookingRecordWithActiveSeatHold,
  confirmBookingSeatWithinCapacity,
  fetchBookingRecordById,
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

test('buildTicketQrCodeUrl embeds the attendee referral value in the Inkryptus link', async () => {
  const referredBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Referred Ticket User',
    email: 'referred-ticket@example.com',
    phone_number: '+255712345697',
    utm_source: 'neema',
  });

  assert.equal(
    buildTicketQrCodeUrl(referredBooking),
    'https://link.inkryptus.com/?referral=neema'
  );
});

test('buildTicketQrCodeUrl still returns a valid Inkryptus link without a referral value', async () => {
  const directBooking = await createConfirmedBooking();

  assert.equal(
    buildTicketQrCodeUrl(directBooking),
    'https://link.inkryptus.com/?referral='
  );
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
  assert.equal(deliveryRecord.qr_payload, 'https://link.inkryptus.com/?referral=');

  const refreshedBooking = await fetchBookingRecordById(confirmedBooking.id);
  assert.ok(refreshedBooking.ticket_sent_at);
  assert.equal(refreshedBooking.ticket_sent_at.getTime(), deliveryRecord.sent_at.getTime());
});

test('deliverTicketForConfirmedBooking records a failed delivery and leaves ticket_sent_at empty', async () => {
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

  const refreshedBooking = await fetchBookingRecordById(confirmedBooking.id);
  assert.equal(refreshedBooking.ticket_sent_at, null);
});

test('deliverTicketForConfirmedBooking sends once when two confirmations race', async () => {
  const confirmedBooking = await createConfirmedBooking();
  let sendCount = 0;
  let releaseFirstSend;
  const firstSendMayFinish = new Promise((resolve) => {
    releaseFirstSend = resolve;
  });

  const slowFirstSender = async () => {
    sendCount += 1;
    await firstSendMayFinish;
    return { ok: true };
  };

  const firstDelivery = deliverTicketForConfirmedBooking(
    confirmedBooking.id,
    slowFirstSender
  );

  // Let the first caller take the claim before the second caller checks it.
  await new Promise((resolve) => setImmediate(resolve));

  const secondDelivery = await deliverTicketForConfirmedBooking(
    confirmedBooking.id,
    async () => {
      sendCount += 1;
      return { ok: true };
    }
  );

  releaseFirstSend();
  const firstDeliveryResult = await firstDelivery;

  assert.equal(firstDeliveryResult.delivered, true);
  assert.equal(secondDelivery.delivered, false);
  assert.equal(secondDelivery.skipped, true);
  assert.equal(sendCount, 1);

  const deliveryRecord = await fetchDeliveryRecordForBooking(confirmedBooking.id);
  assert.equal(deliveryRecord.status, 'sent');
  assert.equal(deliveryRecord.attempt_count, 1);
});

test('deliverTicketForConfirmedBooking never sends a second ticket for the same booking', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const sentBookingIds = [];
  const stubSender = async (bookingRecord) => {
    sentBookingIds.push(bookingRecord.id);
    return { ok: true };
  };

  const firstResult = await deliverTicketForConfirmedBooking(
    confirmedBooking.id,
    stubSender
  );
  const secondResult = await deliverTicketForConfirmedBooking(
    confirmedBooking.id,
    stubSender
  );

  assert.equal(firstResult.delivered, true);
  assert.equal(secondResult.delivered, false);
  assert.equal(secondResult.skipped, true);
  assert.equal(secondResult.reason, TICKET_EMAIL_ALREADY_SENT_REASON);
  assert.deepEqual(sentBookingIds, [confirmedBooking.id]);
});

test('deliverTicketForConfirmedBooking stops at the configured hourly Gmail limit', async () => {
  const previousHourlyLimit = process.env.TICKET_EMAIL_HOURLY_LIMIT;
  process.env.TICKET_EMAIL_HOURLY_LIMIT = '1';

  try {
    const firstBooking = await createConfirmedBooking();
    const secondBooking = await createConfirmedBooking();
    const sentBookingIds = [];
    const stubSender = async (bookingRecord) => {
      sentBookingIds.push(bookingRecord.id);
      return { ok: true };
    };

    const firstResult = await deliverTicketForConfirmedBooking(
      firstBooking.id,
      stubSender
    );
    const secondResult = await deliverTicketForConfirmedBooking(
      secondBooking.id,
      stubSender
    );

    assert.equal(firstResult.delivered, true);
    assert.equal(secondResult.delivered, false);
    assert.equal(secondResult.skipped, true);
    assert.equal(secondResult.reason, TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON);
    assert.deepEqual(sentBookingIds, [firstBooking.id]);

    const secondDeliveryRecord = await fetchDeliveryRecordForBooking(secondBooking.id);
    assert.equal(secondDeliveryRecord.status, 'failed');
    assert.equal(secondDeliveryRecord.last_error, TICKET_EMAIL_HOURLY_LIMIT_REACHED_REASON);

    const secondBookingAfterAttempt = await fetchBookingRecordById(secondBooking.id);
    assert.equal(secondBookingAfterAttempt.ticket_sent_at, null);
  } finally {
    if (previousHourlyLimit === undefined) {
      delete process.env.TICKET_EMAIL_HOURLY_LIMIT;
    } else {
      process.env.TICKET_EMAIL_HOURLY_LIMIT = previousHourlyLimit;
    }
  }
});

test('buildTicketEmailDeliveryFailureMessage explains Apps Script sign-in and deployment failures', () => {
  assert.match(
    buildTicketEmailDeliveryFailureMessage(
      'APPS_SCRIPT_WEBHOOK_FAILED:APPS_SCRIPT_HTTP_401'
    ),
    /requires a sign-in.*\/exec.*Anyone/i
  );
  assert.match(
    buildTicketEmailDeliveryFailureMessage(
      'APPS_SCRIPT_WEBHOOK_FAILED:APPS_SCRIPT_DEV_URL_NOT_ALLOWED'
    ),
    /\/dev test URL.*\/exec/i
  );
  assert.match(
    buildTicketEmailDeliveryFailureMessage(
      'APPS_SCRIPT_WEBHOOK_FAILED:APPS_SCRIPT_RESPONSE_NOT_JSON'
    ),
    /did not return JSON.*\/exec/i
  );
  assert.match(
    buildTicketEmailDeliveryFailureMessage(
      'APPS_SCRIPT_WEBHOOK_FAILED:mail_send_failed: Invalid email: attendee@example.com'
    ),
    /mail service rejected the message: Invalid email: attendee@example.com/
  );
  assert.match(
    buildTicketEmailDeliveryFailureMessage(
      'APPS_SCRIPT_WEBHOOK_FAILED:gmail_quota_check_failed'
    ),
    /diagnoseTicketEmailDelivery.*Gmail permission.*redeploy the current Code\.gs/i
  );
  assert.match(
    buildTicketEmailDeliveryFailureMessage('SMTP refused connection'),
    /Ticket email delivery failed: SMTP refused connection/
  );
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

  const refreshedBooking = await fetchBookingRecordById(confirmedBooking.id);
  assert.ok(refreshedBooking.ticket_sent_at);
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
  assert.match(sentMessages[0].html, /Your ticket is ready/);
  assert.match(sentMessages[0].html, new RegExp(`EVT-${confirmedBooking.ref}`));
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
  assert.equal(sentMessages[0].attachments[0].contentType, 'application/pdf');
});

test('sendTicketEmailToAttendee posts the PDF and booking mirror to the Apps Script web app', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const previousFetch = globalThis.fetch;
  const previousEnvironment = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    APPS_SCRIPT_TICKET_WEBHOOK_URL: process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL,
    APPS_SCRIPT_SHARED_SECRET: process.env.APPS_SCRIPT_SHARED_SECRET,
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
    EVENT_TIME_LABEL: process.env.EVENT_TIME_LABEL,
  };
  const recordedRequests = [];

  globalThis.fetch = async (requestUrl, requestOptions) => {
    recordedRequests.push({ requestUrl, requestOptions });
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          deliveryId: 'apps-script-delivery-id',
          remainingDailyQuota: 89,
        }),
    };
  };

  try {
    process.env.EMAIL_PROVIDER = 'apps_script';
    process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL =
      'https://script.google.com/macros/s/AKfycb-test-deployment/exec';
    process.env.APPS_SCRIPT_SHARED_SECRET = 'test-shared-secret';
    process.env.MAIL_FROM_NAME = 'DienAcademy Events';
    process.env.EVENT_TIME_LABEL = '6:00 PM';

    const sendResult = await sendTicketEmailToAttendee(confirmedBooking);

    assert.equal(sendResult.providerMessageId, 'apps-script-delivery-id');
    assert.equal(recordedRequests.length, 1);

    const postedRequestBody = JSON.parse(recordedRequests[0].requestOptions.body);
    assert.equal(
      postedRequestBody.emailRequest.deliveryKey,
      `ticket:${confirmedBooking.ref}`
    );
    assert.equal(postedRequestBody.emailRequest.emailKind, 'ticket');
    assert.equal(postedRequestBody.emailRequest.booking.attendeeName, 'Ticket User');
    assert.equal(postedRequestBody.emailRequest.event.timeLabel, '6:00 PM');
    assert.equal(postedRequestBody.emailRequest.ticket.currency, 'TZS');
    assert.equal(postedRequestBody.emailRequest.attachments.length, 1);

    const ticketAttachment = postedRequestBody.emailRequest.attachments[0];
    assert.equal(ticketAttachment.fileName, `ticket-${confirmedBooking.ref}.pdf`);
    assert.equal(ticketAttachment.mimeType, 'application/pdf');
    const decodedTicketPdfBuffer = Buffer.from(ticketAttachment.base64Content, 'base64');
    assert.equal(decodedTicketPdfBuffer.subarray(0, 5).toString(), '%PDF-');
  } finally {
    globalThis.fetch = previousFetch;

    for (const [variableName, previousValue] of Object.entries(previousEnvironment)) {
      if (previousValue === undefined) {
        delete process.env[variableName];
      } else {
        process.env[variableName] = previousValue;
      }
    }
  }
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

test('deliverTicketForConfirmedBooking skips email and writes no delivery row when email delivery is disabled', async () => {
  const confirmedBooking = await createConfirmedBooking();
  const previousDeliveryFlag = process.env.EMAIL_DELIVERY_ENABLED;
  process.env.EMAIL_DELIVERY_ENABLED = 'false';

  try {
    let sendTicketEmailWasCalled = false;
    const stubSender = async () => {
      sendTicketEmailWasCalled = true;
      return { ok: true };
    };

    const result = await deliverTicketForConfirmedBooking(
      confirmedBooking.id,
      stubSender
    );

    assert.equal(result.skipped, true);
    assert.equal(result.delivered, false);
    assert.equal(result.reason, TICKET_EMAIL_DELIVERY_DISABLED_REASON);
    assert.equal(sendTicketEmailWasCalled, false);

    const deliveryRecord = await fetchDeliveryRecordForBooking(confirmedBooking.id);
    assert.equal(deliveryRecord, null);
  } finally {
    if (previousDeliveryFlag === undefined) {
      delete process.env.EMAIL_DELIVERY_ENABLED;
    } else {
      process.env.EMAIL_DELIVERY_ENABLED = previousDeliveryFlag;
    }
  }
});

test('redeliverFailedTicketEmail skips sending when email delivery is disabled', async () => {
  const confirmedBooking = await createConfirmedBooking();
  await pool.query(
    `INSERT INTO ticket_deliveries (booking_id, status, attempt_count, last_error)
     VALUES ($1, 'failed', 1, 'SMTP refused connection')`,
    [confirmedBooking.id]
  );

  const previousDeliveryFlag = process.env.EMAIL_DELIVERY_ENABLED;
  process.env.EMAIL_DELIVERY_ENABLED = 'false';

  try {
    let sendTicketEmailWasCalled = false;
    const stubSender = async () => {
      sendTicketEmailWasCalled = true;
      return { ok: true };
    };

    const result = await redeliverFailedTicketEmail(
      confirmedBooking.id,
      stubSender
    );

    assert.equal(result.skipped, true);
    assert.equal(result.reason, TICKET_EMAIL_DELIVERY_DISABLED_REASON);
    assert.equal(sendTicketEmailWasCalled, false);

    const deliveryRecord = await fetchDeliveryRecordForBooking(confirmedBooking.id);
    assert.equal(deliveryRecord.status, 'failed');
    assert.equal(deliveryRecord.attempt_count, 1);
  } finally {
    if (previousDeliveryFlag === undefined) {
      delete process.env.EMAIL_DELIVERY_ENABLED;
    } else {
      process.env.EMAIL_DELIVERY_ENABLED = previousDeliveryFlag;
    }
  }
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
