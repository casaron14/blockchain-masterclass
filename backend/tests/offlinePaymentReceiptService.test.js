import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import pool from '../config/db.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';
import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

import {
  InvalidOfflinePaymentReceiptFileError,
  OfflinePaymentReceiptPaymentMismatchError,
  approveOfflinePaymentReceiptForConfirmedPayment,
  fetchOfflinePaymentReceiptByBookingId,
  fetchOfflinePaymentReceiptForAdminDownload,
  fetchOfflinePaymentReceiptByPaymentId,
  rejectOfflinePaymentReceiptForFailedPayment,
  resolveOfflinePaymentReceiptAbsoluteFilePath,
  storeOfflinePaymentReceiptForPayment,
  validateOfflinePaymentReceiptUpload,
} from '../services/offlinePaymentReceiptService.js';

const VALID_PNG_RECEIPT_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

async function removeStoredReceiptFile(offlineReceiptRecord) {
  if (!offlineReceiptRecord) {
    return;
  }
  await fs
    .unlink(resolveOfflinePaymentReceiptAbsoluteFilePath(offlineReceiptRecord))
    .catch(() => {});
}

beforeEach(resetDatabaseState);

test('validateOfflinePaymentReceiptUpload rejects a file that is not a receipt', () => {
  assert.throws(
    () =>
      validateOfflinePaymentReceiptUpload({
        receiptFileBuffer: Buffer.from('not a receipt'),
        originalFileName: 'receipt.txt',
        declaredMimeType: 'text/plain',
      }),
    (error) =>
      error instanceof InvalidOfflinePaymentReceiptFileError &&
      /PDF, JPEG, PNG, or WebP/.test(error.message)
  );
});

test('storeOfflinePaymentReceiptForPayment stores a Lipa Namba receipt for admin review', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Receipt Uploader',
    email: 'receipt-uploader@example.com',
    phone_number: '+255712345685',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'lipanamba'
  );

  const offlineReceiptRecord = await storeOfflinePaymentReceiptForPayment({
    paymentRecord,
    bookingRecord,
    receiptFileBuffer: VALID_PNG_RECEIPT_BUFFER,
    originalFileName: 'lipa-namba-receipt.png',
    declaredMimeType: 'image/png',
  });

  try {
    assert.equal(offlineReceiptRecord.paymentId, Number(paymentRecord.id));
    assert.equal(offlineReceiptRecord.bookingId, Number(bookingRecord.id));
    assert.equal(offlineReceiptRecord.status, 'submitted');
    assert.equal(offlineReceiptRecord.mimeType, 'image/png');
    assert.equal(offlineReceiptRecord.originalFileName, 'lipa-namba-receipt.png');

    const readableFile = await fs.readFile(
      resolveOfflinePaymentReceiptAbsoluteFilePath(offlineReceiptRecord)
    );
    assert.deepEqual(readableFile, VALID_PNG_RECEIPT_BUFFER);

    const receiptByPayment = await fetchOfflinePaymentReceiptByPaymentId(
      paymentRecord.id
    );
    assert.equal(receiptByPayment.id, offlineReceiptRecord.id);

    const receiptByBooking = await fetchOfflinePaymentReceiptByBookingId(
      bookingRecord.id
    );
    assert.equal(receiptByBooking.id, offlineReceiptRecord.id);
  } finally {
    await removeStoredReceiptFile(offlineReceiptRecord);
  }
});

test('storeOfflinePaymentReceiptForPayment rejects receipts for a non-Lipa Namba payment', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Wrong Method User',
    email: 'wrong-method@example.com',
    phone_number: '+255712345686',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'usdt_bep20'
  );

  await assert.rejects(
    () =>
      storeOfflinePaymentReceiptForPayment({
        paymentRecord,
        bookingRecord,
        receiptFileBuffer: VALID_PNG_RECEIPT_BUFFER,
        originalFileName: 'receipt.png',
        declaredMimeType: 'image/png',
      }),
    (error) => error instanceof OfflinePaymentReceiptPaymentMismatchError
  );
});

test('admin review marks an uploaded receipt approved or rejected', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Receipt Reviewer',
    email: 'receipt-reviewer@example.com',
    phone_number: '+255712345687',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'lipanamba'
  );
  const offlineReceiptRecord = await storeOfflinePaymentReceiptForPayment({
    paymentRecord,
    bookingRecord,
    receiptFileBuffer: VALID_PNG_RECEIPT_BUFFER,
    originalFileName: 'receipt.png',
    declaredMimeType: 'image/png',
  });

  try {
    const approvedReceipt = await approveOfflinePaymentReceiptForConfirmedPayment(
      paymentRecord.id
    );
    assert.equal(approvedReceipt.status, 'approved');
    assert.ok(approvedReceipt.reviewedAt);

    const rejectedReceipt = await rejectOfflinePaymentReceiptForFailedPayment(
      paymentRecord.id,
      'The receipt did not match a Lipa Namba payment'
    );
    assert.equal(rejectedReceipt.status, 'rejected');
    assert.equal(
      rejectedReceipt.reviewerNote,
      'The receipt did not match a Lipa Namba payment'
    );
  } finally {
    await removeStoredReceiptFile(offlineReceiptRecord);
  }
});

test('the admin download returns the uploaded bytes from the database when disk storage is off', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Serverless Receipt Uploader',
    email: 'serverless-receipt@example.com',
    phone_number: '+255712345687',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'lipanamba'
  );

  const previousDocumentStorageMode = process.env.DOCUMENT_STORAGE_MODE;
  process.env.DOCUMENT_STORAGE_MODE = 'memory';

  try {
    const offlineReceiptRecord = await storeOfflinePaymentReceiptForPayment({
      paymentRecord,
      bookingRecord,
      receiptFileBuffer: VALID_PNG_RECEIPT_BUFFER,
      originalFileName: 'serverless-receipt.png',
      declaredMimeType: 'image/png',
    });

    assert.equal(offlineReceiptRecord.hasStoredFileData, true);

    await assert.rejects(
      () =>
        fs.access(resolveOfflinePaymentReceiptAbsoluteFilePath(offlineReceiptRecord)),
      (error) => error.code === 'ENOENT'
    );

    const downloadResult = await fetchOfflinePaymentReceiptForAdminDownload(bookingRecord.id);
    assert.equal(downloadResult.receiptRecord.id, offlineReceiptRecord.id);
    assert.equal(downloadResult.absoluteFilePath, null);
    assert.deepEqual(downloadResult.fileBuffer, VALID_PNG_RECEIPT_BUFFER);
  } finally {
    if (previousDocumentStorageMode === undefined) {
      delete process.env.DOCUMENT_STORAGE_MODE;
    } else {
      process.env.DOCUMENT_STORAGE_MODE = previousDocumentStorageMode;
    }
  }
});

test('the admin download falls back to the stored disk file for a legacy receipt row', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Legacy Receipt Uploader',
    email: 'legacy-receipt@example.com',
    phone_number: '+255712345688',
  });
  const paymentRecord = await createPendingPaymentRecordForBooking(
    bookingRecord.id,
    'lipanamba'
  );

  const offlineReceiptRecord = await storeOfflinePaymentReceiptForPayment({
    paymentRecord,
    bookingRecord,
    receiptFileBuffer: VALID_PNG_RECEIPT_BUFFER,
    originalFileName: 'legacy-receipt.png',
    declaredMimeType: 'image/png',
  });

  try {
    // A row created before file_data existed has only stored_file_name.
    await pool.query(
      'UPDATE offline_payment_receipts SET file_data = NULL WHERE id = $1',
      [offlineReceiptRecord.id]
    );

    const downloadResult = await fetchOfflinePaymentReceiptForAdminDownload(bookingRecord.id);
    assert.ok(downloadResult.absoluteFilePath);
    assert.deepEqual(downloadResult.fileBuffer, VALID_PNG_RECEIPT_BUFFER);
  } finally {
    await removeStoredReceiptFile(offlineReceiptRecord);
  }
});
