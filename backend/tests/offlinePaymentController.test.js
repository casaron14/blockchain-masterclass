import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import pool from '../config/db.js';

import offlinePaymentController from '../controller/offlinePaymentController.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';
import { resolveOfflinePaymentReceiptAbsoluteFilePath } from '../services/offlinePaymentReceiptService.js';

const VALID_PNG_RECEIPT_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function createMockResponse() {
  const capturedResponse = { statusCode: null, body: null };

  return {
    status(statusCode) {
      capturedResponse.statusCode = statusCode;
      return this;
    },
    json(body) {
      capturedResponse.body = body;
      return this;
    },
    capturedResponse,
  };
}

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

async function createLipaNambaPaymentFixture() {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Controller Receipt User',
    email: 'controller-receipt@example.com',
    phone_number: '+255712345688',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'lipanamba'
  );
  return { bookingRecord, paymentRecord };
}

beforeEach(resetDatabaseState);

test('uploadLipaNambaPaymentReceiptEndpoint requires the booking reference', async () => {
  const { bookingRecord, paymentRecord } = await createLipaNambaPaymentFixture();
  const response = createMockResponse();

  await offlinePaymentController.uploadLipaNambaPaymentReceiptEndpoint(
    {
      params: { id: String(paymentRecord.id) },
      body: {},
      file: {
        buffer: VALID_PNG_RECEIPT_BUFFER,
        originalname: 'receipt.png',
        mimetype: 'image/png',
      },
    },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
  assert.match(response.capturedResponse.body.message, /booking_ref/);
  assert.equal(bookingRecord.ref.length, 6);
});

test('uploadLipaNambaPaymentReceiptEndpoint rejects a mismatched booking reference', async () => {
  const { paymentRecord } = await createLipaNambaPaymentFixture();
  const response = createMockResponse();

  await offlinePaymentController.uploadLipaNambaPaymentReceiptEndpoint(
    {
      params: { id: String(paymentRecord.id) },
      body: { booking_ref: 'WRONG1' },
      file: {
        buffer: VALID_PNG_RECEIPT_BUFFER,
        originalname: 'receipt.png',
        mimetype: 'image/png',
      },
    },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 403);
  assert.match(response.capturedResponse.body.message, /does not match/);
});

test('uploadLipaNambaPaymentReceiptEndpoint stores a valid receipt for admin review', async () => {
  const { bookingRecord, paymentRecord } = await createLipaNambaPaymentFixture();
  const response = createMockResponse();

  await offlinePaymentController.uploadLipaNambaPaymentReceiptEndpoint(
    {
      params: { id: String(paymentRecord.id) },
      body: { booking_ref: bookingRecord.ref },
      file: {
        buffer: VALID_PNG_RECEIPT_BUFFER,
        originalname: 'receipt.png',
        mimetype: 'image/png',
      },
    },
    response
  );

  try {
    assert.equal(response.capturedResponse.statusCode, 201);
    assert.equal(response.capturedResponse.body.offlineReceipt.status, 'submitted');
    assert.equal(
      response.capturedResponse.body.offlineReceipt.originalFileName,
      'receipt.png'
    );
  } finally {
    const offlineReceipt = response.capturedResponse.body.offlineReceipt;
    if (offlineReceipt) {
      await fs
        .unlink(resolveOfflinePaymentReceiptAbsoluteFilePath(offlineReceipt))
        .catch(() => {});
    }
  }
});
