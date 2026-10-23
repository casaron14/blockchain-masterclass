import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pool from '../config/db.js';

import {
  formatTanzanianPhoneNumberForAzamPay,
  resolveAzamPayAuthBaseUrl,
  resolveAzamPayCheckoutBaseUrl,
} from '../services/azamPayClient.js';

import {
  initiateAzamPesaPayment,
  processAzamPayWebhook,
  fetchPaymentRecordByBookingId,
} from '../services/paymentService.js';

import { createBookingRecordWithActiveSeatHold, fetchEventAvailabilitySnapshot } from '../services/bookingService.js';
import { TICKET_PRICE_TZS } from '../services/eventConfigService.js';

const PREVIOUS_AUTH_BASE_URL = process.env.AZAMPAY_AUTH_BASE_URL;
const PREVIOUS_CHECKOUT_BASE_URL = process.env.AZAMPAY_CHECKOUT_BASE_URL;
const PREVIOUS_API_KEY = process.env.AZAMPAY_API_KEY;

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

afterEach(() => {
  process.env.AZAMPAY_AUTH_BASE_URL = PREVIOUS_AUTH_BASE_URL;
  process.env.AZAMPAY_CHECKOUT_BASE_URL = PREVIOUS_CHECKOUT_BASE_URL;
  process.env.AZAMPAY_API_KEY = PREVIOUS_API_KEY;
});

// AzamPesa is retired for new payments, so this fixture writes the historical
// payment row the way an older deployment would have left it. The service under
// test (initiation + webhook) still has to read and reconcile such rows.
async function createAzamPesaPaymentForBooking(phoneNumber = '+255712345690') {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'AzamPesa User',
    email: 'azampesa@example.com',
    phone_number: phoneNumber,
  });
  const paymentInsertResult = await pool.query(
    `INSERT INTO payments (booking_id, payment_method, amount_expected, status)
     VALUES ($1, 'azampesa', $2, 'pending')
     RETURNING *`,
    [bookingRecord.id, TICKET_PRICE_TZS]
  );
  return { bookingRecord, paymentRecord: paymentInsertResult.rows[0] };
}

function startAzamPayStubServer() {
  return new Promise((resolve) => {
    const capturedRequests = [];

    const stubServer = http.createServer((req, res) => {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        capturedRequests.push({
          url: req.url,
          method: req.method,
          authorization: req.headers.authorization,
          xApiKey: req.headers['x-api-key'],
          contentType: req.headers['content-type'],
          body: rawBody ? JSON.parse(rawBody) : {},
        });

        if (req.url.includes('GenerateToken')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              data: {
                accessToken: 'stub-access-token',
                expire: new Date(Date.now() + 3600000).toISOString(),
              },
              success: true,
            })
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            transactionId: 'stub-transaction-123',
            message: 'Your request has been received and is being processed.',
          })
        );
      });
    });

    stubServer.listen(0, () => {
      resolve({
        stubServer,
        port: stubServer.address().port,
        capturedRequests,
      });
    });
  });
}

test('formatTanzanianPhoneNumberForAzamPay normalizes to 2557XXXXXXXX', () => {
  assert.equal(formatTanzanianPhoneNumberForAzamPay('+255712345678'), '255712345678');
  assert.equal(formatTanzanianPhoneNumberForAzamPay('0712345678'), '255712345678');
  assert.equal(formatTanzanianPhoneNumberForAzamPay('255712345678'), '255712345678');
});

test('initiateAzamPesaPayment sends a correctly shaped checkout request and moves to pending', async () => {
  const { bookingRecord, paymentRecord } = await createAzamPesaPaymentForBooking();
  const { stubServer, port, capturedRequests } = await startAzamPayStubServer();

  process.env.AZAMPAY_AUTH_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AZAMPAY_CHECKOUT_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AZAMPAY_API_KEY = 'stub-api-key';

  try {
    const initiationResult = await initiateAzamPesaPayment(bookingRecord.id, bookingRecord);

    assert.equal(initiationResult.status, 'pending');
    assert.equal(initiationResult.transactionId, 'stub-transaction-123');
    assert.ok(initiationResult.externalId);

    const checkoutRequest = capturedRequests.find((request) =>
      request.url.includes('azampay/mno/checkout')
    );
    assert.ok(checkoutRequest, 'checkout endpoint was called');

    const checkoutBody = checkoutRequest.body;
    assert.equal(checkoutBody.accountNumber, '255712345690');
    assert.equal(checkoutBody.currency, 'TZS');
    assert.equal(checkoutBody.provider, 'Azampesa');
    assert.equal(String(checkoutBody.amount), '10000');
    assert.equal(checkoutBody.externalId, initiationResult.externalId);
    assert.equal(checkoutRequest.xApiKey, 'stub-api-key', 'checkout must send the X-API-Key header');

    const tokenRequest = capturedRequests.find((request) =>
      request.url.includes('GenerateToken')
    );
    assert.ok(tokenRequest, 'token endpoint was called');
    assert.equal(tokenRequest.xApiKey, undefined, 'token request does not send the X-API-Key header');

    const refreshedPayment = await fetchPaymentRecordByBookingId(bookingRecord.id);
    assert.equal(refreshedPayment.status, 'pending');
    assert.equal(refreshedPayment.reference_id, initiationResult.externalId);
  } finally {
    stubServer.close();
  }
});

test('initiateAzamPesaPayment uses a provided phone number override for the STK push', async () => {
  const { bookingRecord, paymentRecord } = await createAzamPesaPaymentForBooking();
  const { stubServer, port, capturedRequests } = await startAzamPayStubServer();

  process.env.AZAMPAY_AUTH_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AZAMPAY_CHECKOUT_BASE_URL = `http://127.0.0.1:${port}`;

  try {
    const overridePhoneNumber = '+255799887766';
    await initiateAzamPesaPayment(
      bookingRecord.id,
      bookingRecord,
      overridePhoneNumber
    );

    const checkoutRequest = capturedRequests.find((request) =>
      request.url.includes('azampay/mno/checkout')
    );
    assert.ok(checkoutRequest, 'checkout endpoint was called');
    assert.equal(checkoutBodyAccountNumber(checkoutRequest.body), '255799887766');
    assert.notEqual(checkoutRequest.body.accountNumber, '255712345690');
  } finally {
    stubServer.close();
  }
});

test('initiateAzamPesaPayment does not downgrade an already confirmed payment', async () => {
  const { bookingRecord, paymentRecord } = await createAzamPesaPaymentForBooking();
  const { stubServer, port } = await startAzamPayStubServer();

  await pool.query(
    "UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE id = $1",
    [paymentRecord.id]
  );

  process.env.AZAMPAY_AUTH_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AZAMPAY_CHECKOUT_BASE_URL = `http://127.0.0.1:${port}`;

  try {
    const initiationResult = await initiateAzamPesaPayment(bookingRecord.id, bookingRecord);

    assert.equal(initiationResult.status, 'confirmed');

    const refreshedPayment = await fetchPaymentRecordByBookingId(bookingRecord.id);
    assert.equal(refreshedPayment.status, 'confirmed');
    assert.ok(refreshedPayment.confirmed_at);
  } finally {
    stubServer.close();
  }
});

function checkoutBodyAccountNumber(checkoutBody) {
  return checkoutBody.accountNumber;
}

test('processAzamPayWebhook confirms payment and booking on success', async () => {
  const { bookingRecord, paymentRecord } = await createAzamPesaPaymentForBooking();
  const externalId = 'utility-ref-123';

  await pool.query('UPDATE payments SET reference_id = $1 WHERE id = $2', [
    externalId,
    paymentRecord.id,
  ]);

  const stubTicketDelivery = async () => ({ delivered: true });

  const result = await processAzamPayWebhook(
    {
      utilityref: externalId,
      transactionstatus: 'success',
      amount: '10000',
    },
    stubTicketDelivery
  );

  assert.equal(result.bookingId, bookingRecord.id);
  assert.equal(result.transactionStatus, 'success');

  const confirmedPayment = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(confirmedPayment.status, 'confirmed');
  assert.ok(confirmedPayment.confirmed_at);

  const bookingStatus = await pool.query('SELECT status FROM bookings WHERE id = $1', [
    bookingRecord.id,
  ]);
  assert.equal(bookingStatus.rows[0].status, 'confirmed');

  const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
  assert.equal(availabilitySnapshot.confirmedCount, 1);
});

test('processAzamPayWebhook marks payment failed on a declined transaction', async () => {
  const { bookingRecord, paymentRecord } = await createAzamPesaPaymentForBooking();
  const externalId = 'utility-ref-failed';

  await pool.query('UPDATE payments SET reference_id = $1 WHERE id = $2', [
    externalId,
    paymentRecord.id,
  ]);

  await processAzamPayWebhook({
    utilityref: externalId,
    transactionstatus: 'failed',
  });

  const failedPayment = await fetchPaymentRecordByBookingId(bookingRecord.id);
  assert.equal(failedPayment.status, 'failed');

  const bookingStatus = await pool.query('SELECT status FROM bookings WHERE id = $1', [
    bookingRecord.id,
  ]);
  assert.equal(bookingStatus.rows[0].status, 'pending');
});

test('processAzamPayWebhook rejects a webhook for an unknown transaction', async () => {
  await assert.rejects(
    () =>
      processAzamPayWebhook({
        utilityref: 'unknown-external-id',
        transactionstatus: 'success',
      }),
    (error) => error.message === 'AZAMPAY_WEBHOOK_UNKNOWN_TRANSACTION'
  );
});

test('resolveAzamPayBaseUrls default to sandbox hosts unless overridden', () => {
  process.env.AZAMPAY_AUTH_BASE_URL = '';
  process.env.AZAMPAY_CHECKOUT_BASE_URL = '';
  process.env.AZAMPAY_MODE = 'sandbox';

  assert.equal(resolveAzamPayAuthBaseUrl(), 'https://authenticator-sandbox.azampay.co.tz');
  assert.equal(resolveAzamPayCheckoutBaseUrl(), 'https://sandbox.azampay.co.tz');
});
