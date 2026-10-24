import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pool from '../config/db.js';
import { isLocalDocumentStorageEnabled } from '../config/documentStorage.js';

import { PAYMENT_METHOD_LIPANAMBA } from './eventConfigService.js';
import {
  downloadOfflinePaymentReceiptObject,
  removeOfflinePaymentReceiptObject,
  SupabaseReceiptStorageObjectNotFoundError,
  uploadOfflinePaymentReceiptObject,
} from './supabaseReceiptStorageService.js';

// Vercel rejects a serverless request body above 4.5 MB before it reaches the
// function, so the deployed default is deliberately below that. A self-hosted
// process keeps the 5 MB default. The override exists for providers with a
// different ceiling (or for a local proxy that allows more).
const DEFAULT_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES =
  process.env.VERCEL === '1' ? 4 * 1024 * 1024 : 5 * 1024 * 1024;

export const MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES = Number(
  process.env.MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES ||
    DEFAULT_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES
);

export const MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_LABEL = `${Math.floor(
  MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES / (1024 * 1024)
)} MB`;

const OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../out/offline-payment-receipts'
);

const SUPPORTED_RECEIPT_FILE_TYPES = Object.freeze([
  {
    mimeType: 'application/pdf',
    fileExtension: 'pdf',
    matchesFileSignature: (fileBuffer) =>
      fileBuffer.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  {
    mimeType: 'image/jpeg',
    fileExtension: 'jpg',
    matchesFileSignature: (fileBuffer) =>
      fileBuffer.length >= 3 &&
      fileBuffer[0] === 0xff &&
      fileBuffer[1] === 0xd8 &&
      fileBuffer[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    fileExtension: 'png',
    matchesFileSignature: (fileBuffer) =>
      fileBuffer.length >= 8 &&
      fileBuffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ),
  },
  {
    mimeType: 'image/webp',
    fileExtension: 'webp',
    matchesFileSignature: (fileBuffer) =>
      fileBuffer.length >= 12 &&
      fileBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      fileBuffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
]);

export class InvalidOfflinePaymentReceiptFileError extends Error {
  constructor(reasonMessage) {
    super(reasonMessage);
    this.name = 'InvalidOfflinePaymentReceiptFileError';
    this.code = 'INVALID_OFFLINE_PAYMENT_RECEIPT_FILE';
  }
}

export class OfflinePaymentReceiptPaymentMismatchError extends Error {
  constructor(paymentMethod) {
    super(`Offline payment receipts are only accepted for ${PAYMENT_METHOD_LIPANAMBA} payments`);
    this.name = 'OfflinePaymentReceiptPaymentMismatchError';
    this.code = 'OFFLINE_PAYMENT_RECEIPT_PAYMENT_MISMATCH';
    this.paymentMethod = paymentMethod;
  }
}

export class OfflinePaymentReceiptPaymentAlreadyConfirmedError extends Error {
  constructor(paymentId) {
    super(`Payment ${paymentId} is already confirmed and cannot receive a new receipt`);
    this.name = 'OfflinePaymentReceiptPaymentAlreadyConfirmedError';
    this.code = 'OFFLINE_PAYMENT_RECEIPT_PAYMENT_ALREADY_CONFIRMED';
  }
}

export class OfflinePaymentReceiptNotFoundError extends Error {
  constructor(bookingId) {
    super(`No offline payment receipt was uploaded for booking ${bookingId}`);
    this.name = 'OfflinePaymentReceiptNotFoundError';
    this.code = 'OFFLINE_PAYMENT_RECEIPT_NOT_FOUND';
  }
}

export class OfflinePaymentReceiptFileMissingError extends Error {
  constructor(filePath) {
    super(`Offline payment receipt file is missing at ${filePath}`);
    this.name = 'OfflinePaymentReceiptFileMissingError';
    this.code = 'OFFLINE_PAYMENT_RECEIPT_FILE_MISSING';
  }
}

export function detectOfflinePaymentReceiptFileType(receiptFileBuffer) {
  if (!Buffer.isBuffer(receiptFileBuffer) || receiptFileBuffer.length === 0) {
    return null;
  }

  return (
    SUPPORTED_RECEIPT_FILE_TYPES.find((supportedFileType) =>
      supportedFileType.matchesFileSignature(receiptFileBuffer)
    ) ?? null
  );
}

export function validateOfflinePaymentReceiptUpload({
  receiptFileBuffer,
  originalFileName,
  declaredMimeType,
}) {
  if (!Buffer.isBuffer(receiptFileBuffer) || receiptFileBuffer.length === 0) {
    throw new InvalidOfflinePaymentReceiptFileError('The uploaded receipt file is empty');
  }

  if (receiptFileBuffer.length > MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES) {
    throw new InvalidOfflinePaymentReceiptFileError(
      `The uploaded receipt must be ${MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_LABEL} or smaller`
    );
  }

  const detectedFileType = detectOfflinePaymentReceiptFileType(receiptFileBuffer);
  if (!detectedFileType) {
    throw new InvalidOfflinePaymentReceiptFileError(
      'The uploaded receipt must be a PDF, JPEG, PNG, or WebP file'
    );
  }

  if (
    declaredMimeType &&
    declaredMimeType !== 'application/octet-stream' &&
    declaredMimeType !== detectedFileType.mimeType &&
    !(declaredMimeType === 'image/jpg' && detectedFileType.mimeType === 'image/jpeg')
  ) {
    throw new InvalidOfflinePaymentReceiptFileError(
      'The uploaded receipt file type does not match its contents'
    );
  }

  const normalizedOriginalFileName =
    typeof originalFileName === 'string' && originalFileName.trim().length > 0
      ? path.basename(originalFileName).trim()
      : `lipanamba-receipt.${detectedFileType.fileExtension}`;

  return {
    ...detectedFileType,
    originalFileName: normalizedOriginalFileName,
  };
}

export function buildOfflinePaymentReceiptStoredFileName({
  bookingReferenceCode,
  paymentId,
  fileExtension,
}) {
  const safeBookingReference = String(bookingReferenceCode || 'booking').replace(
    /[^a-zA-Z0-9-_]/g,
    ''
  );
  const randomSuffix = crypto.randomBytes(8).toString('hex');

  return `lipanamba-${safeBookingReference}-payment-${paymentId}-${Date.now()}-${randomSuffix}.${fileExtension}`;
}

// file_data can be several megabytes, so it is never part of a normal read.
// The boolean tells callers whether the bytes are in the database without
// pulling them across the wire.
const OFFLINE_PAYMENT_RECEIPT_READABLE_COLUMNS = `
  id, payment_id, booking_id, original_file_name, stored_file_name, mime_type,
  file_size_bytes, file_sha256, storage_object_path, status, reviewer_note,
  uploaded_at, reviewed_at,
  created_at, updated_at, (file_data IS NOT NULL) AS has_file_data
`;

function normalizeOfflinePaymentReceiptRecord(receiptRow) {
  if (!receiptRow) {
    return null;
  }

  return {
    id: Number(receiptRow.id),
    paymentId: Number(receiptRow.payment_id),
    bookingId: Number(receiptRow.booking_id),
    originalFileName: receiptRow.original_file_name,
    storedFileName: receiptRow.stored_file_name,
    mimeType: receiptRow.mime_type,
    fileSizeBytes: Number(receiptRow.file_size_bytes),
    fileSha256: receiptRow.file_sha256,
    hasStoredFileData: receiptRow.has_file_data === true,
    status: receiptRow.status,
    reviewerNote: receiptRow.reviewer_note,
    uploadedAt: receiptRow.uploaded_at,
    reviewedAt: receiptRow.reviewed_at,
    createdAt: receiptRow.created_at,
    updatedAt: receiptRow.updated_at,
  };
}

export async function fetchOfflinePaymentReceiptByPaymentId(paymentId) {
  const fetchResult = await pool.query(
    `SELECT ${OFFLINE_PAYMENT_RECEIPT_READABLE_COLUMNS}
       FROM offline_payment_receipts
      WHERE payment_id = $1`,
    [paymentId]
  );
  return normalizeOfflinePaymentReceiptRecord(fetchResult.rows[0]);
}

export async function fetchOfflinePaymentReceiptByBookingId(bookingId) {
  const fetchResult = await pool.query(
    `SELECT ${OFFLINE_PAYMENT_RECEIPT_READABLE_COLUMNS}
       FROM offline_payment_receipts
      WHERE booking_id = $1`,
    [bookingId]
  );
  return normalizeOfflinePaymentReceiptRecord(fetchResult.rows[0]);
}

export function resolveOfflinePaymentReceiptAbsoluteFilePath(receiptRecord) {
  const absoluteFilePath = path.resolve(
    OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH,
    receiptRecord.storedFileName
  );
  const expectedDirectoryPrefix = `${OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH}${path.sep}`;

  if (!absoluteFilePath.startsWith(expectedDirectoryPrefix)) {
    throw new Error('OFFLINE_PAYMENT_RECEIPT_PATH_OUTSIDE_STORAGE_DIRECTORY');
  }

  return absoluteFilePath;
}

async function removeStoredOfflinePaymentReceiptFile(storedFileName) {
  if (!storedFileName) {
    return;
  }

  const absoluteFilePath = path.resolve(
    OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH,
    storedFileName
  );
  if (!absoluteFilePath.startsWith(`${OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH}${path.sep}`)) {
    return;
  }

  await fs.unlink(absoluteFilePath).catch(() => {});
}

export async function storeOfflinePaymentReceiptForPayment({
  paymentRecord,
  bookingRecord,
  receiptFileBuffer,
  originalFileName,
  declaredMimeType,
}) {
  if (paymentRecord.payment_method !== PAYMENT_METHOD_LIPANAMBA) {
    throw new OfflinePaymentReceiptPaymentMismatchError(paymentRecord.payment_method);
  }

  if (paymentRecord.status === 'confirmed') {
    throw new OfflinePaymentReceiptPaymentAlreadyConfirmedError(paymentRecord.id);
  }

  const validatedFile = validateOfflinePaymentReceiptUpload({
    receiptFileBuffer,
    originalFileName,
    declaredMimeType,
  });

  const storedFileName = buildOfflinePaymentReceiptStoredFileName({
    bookingReferenceCode: bookingRecord.ref,
    paymentId: paymentRecord.id,
    fileExtension: validatedFile.fileExtension,
  });
  const absoluteFilePath = path.join(
    OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH,
    storedFileName
  );
  const configuredReceiptStorageMode = String(
    process.env.OFFLINE_PAYMENT_RECEIPT_STORAGE || ''
  )
    .trim()
    .toLowerCase();
  if (configuredReceiptStorageMode && configuredReceiptStorageMode !== 'supabase') {
    throw new Error(
      'OFFLINE_PAYMENT_RECEIPT_STORAGE must be unset or set to "supabase"'
    );
  }
  const shouldStoreReceiptFileInSupabase = configuredReceiptStorageMode === 'supabase';
  const storageObjectPath = shouldStoreReceiptFileInSupabase
    ? `receipts/${storedFileName}`
    : null;
  const fileSha256 = crypto.createHash('sha256').update(receiptFileBuffer).digest('hex');
  const shouldStoreReceiptFileOnDisk = isLocalDocumentStorageEnabled();

  let wasReceiptUploadedToSupabase = false;
  let wasReceiptRecordSavedToDatabase = false;
  try {
    if (shouldStoreReceiptFileInSupabase) {
      await uploadOfflinePaymentReceiptObject(
        storageObjectPath,
        receiptFileBuffer,
        validatedFile.mimeType
      );
      wasReceiptUploadedToSupabase = true;
    }

    if (shouldStoreReceiptFileOnDisk) {
      await fs.mkdir(OFFLINE_PAYMENT_RECEIPT_DIRECTORY_PATH, { recursive: true });
      await fs.writeFile(absoluteFilePath, receiptFileBuffer);
    }

    const previousReceipt = await fetchOfflinePaymentReceiptByPaymentId(paymentRecord.id);
    const previousStorageObjectResult = previousReceipt
      ? await pool.query(
          'SELECT storage_object_path FROM offline_payment_receipts WHERE id = $1',
          [previousReceipt.id]
        )
      : null;
    const previousStorageObjectPath =
      previousStorageObjectResult?.rows[0]?.storage_object_path ?? null;

    const upsertResult = await pool.query(
      `INSERT INTO offline_payment_receipts
         (payment_id, booking_id, original_file_name, stored_file_name, mime_type,
          file_size_bytes, file_sha256, storage_object_path, file_data, status, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted', now())
       ON CONFLICT (payment_id) DO UPDATE
         SET booking_id = EXCLUDED.booking_id,
             original_file_name = EXCLUDED.original_file_name,
             stored_file_name = EXCLUDED.stored_file_name,
             mime_type = EXCLUDED.mime_type,
             file_size_bytes = EXCLUDED.file_size_bytes,
             file_sha256 = EXCLUDED.file_sha256,
             storage_object_path = EXCLUDED.storage_object_path,
             file_data = EXCLUDED.file_data,
             status = 'submitted',
             reviewer_note = NULL,
             uploaded_at = now(),
             reviewed_at = NULL,
             updated_at = now()
       RETURNING ${OFFLINE_PAYMENT_RECEIPT_READABLE_COLUMNS}`,
      [
        paymentRecord.id,
        bookingRecord.id,
        validatedFile.originalFileName,
        storedFileName,
        validatedFile.mimeType,
        receiptFileBuffer.length,
        fileSha256,
        storageObjectPath,
        shouldStoreReceiptFileInSupabase ? null : receiptFileBuffer,
      ]
    );
    wasReceiptRecordSavedToDatabase = true;

    await pool.query(
      `UPDATE payments
          SET status = 'pending', confirmed_at = NULL, updated_at = now()
        WHERE id = $1
          AND status IN ('failed', 'expired')`,
      [paymentRecord.id]
    );

    if (previousReceipt && previousReceipt.storedFileName !== storedFileName) {
      await removeStoredOfflinePaymentReceiptFile(previousReceipt.storedFileName);
    }
    if (
      previousStorageObjectPath &&
      previousStorageObjectPath !== storageObjectPath
    ) {
      try {
        await removeOfflinePaymentReceiptObject(previousStorageObjectPath);
      } catch (error) {
        console.error('Unable to remove replaced Supabase receipt object', error.message);
      }
    }

    return normalizeOfflinePaymentReceiptRecord(upsertResult.rows[0]);
  } catch (error) {
    if (shouldStoreReceiptFileOnDisk && !wasReceiptRecordSavedToDatabase) {
      await removeStoredOfflinePaymentReceiptFile(storedFileName);
    }
    if (wasReceiptUploadedToSupabase && !wasReceiptRecordSavedToDatabase) {
      try {
        await removeOfflinePaymentReceiptObject(storageObjectPath);
      } catch (cleanupError) {
        console.error(
          'Unable to remove unreferenced Supabase receipt object',
          cleanupError.message
        );
      }
    }
    throw error;
  }
}

export async function approveOfflinePaymentReceiptForConfirmedPayment(paymentId) {
  const updateResult = await pool.query(
    `UPDATE offline_payment_receipts
        SET status = 'approved',
            reviewed_at = now(),
            reviewer_note = NULL
      WHERE payment_id = $1
      RETURNING ${OFFLINE_PAYMENT_RECEIPT_READABLE_COLUMNS}`,
    [paymentId]
  );

  return normalizeOfflinePaymentReceiptRecord(updateResult.rows[0]);
}

export async function rejectOfflinePaymentReceiptForFailedPayment(paymentId, reviewerNote = null) {
  const updateResult = await pool.query(
    `UPDATE offline_payment_receipts
        SET status = 'rejected',
            reviewed_at = now(),
            reviewer_note = $2
      WHERE payment_id = $1
      RETURNING ${OFFLINE_PAYMENT_RECEIPT_READABLE_COLUMNS}`,
    [paymentId, reviewerNote]
  );

  return normalizeOfflinePaymentReceiptRecord(updateResult.rows[0]);
}

// Older receipts can still be stored in PostgreSQL or on disk. New Supabase
// objects are fetched server-side so private bucket access never reaches clients.
export async function fetchOfflinePaymentReceiptForAdminDownload(bookingId) {
  const receiptRecord = await fetchOfflinePaymentReceiptByBookingId(bookingId);
  if (!receiptRecord) {
    throw new OfflinePaymentReceiptNotFoundError(bookingId);
  }

  const storedFileDataResult = await pool.query(
    `SELECT file_data, storage_object_path
       FROM offline_payment_receipts
      WHERE booking_id = $1`,
    [bookingId]
  );
  const storedFileData = storedFileDataResult.rows[0]?.file_data;
  const storageObjectPath = storedFileDataResult.rows[0]?.storage_object_path;

  if (storedFileData) {
    return {
      receiptRecord,
      fileBuffer: Buffer.from(storedFileData),
      absoluteFilePath: null,
    };
  }

  if (storageObjectPath) {
    try {
      return {
        receiptRecord,
        fileBuffer: await downloadOfflinePaymentReceiptObject(storageObjectPath),
        absoluteFilePath: null,
      };
    } catch (error) {
      if (error instanceof SupabaseReceiptStorageObjectNotFoundError) {
        throw new OfflinePaymentReceiptFileMissingError(storageObjectPath);
      }
      throw error;
    }
  }

  const absoluteFilePath = resolveOfflinePaymentReceiptAbsoluteFilePath(receiptRecord);
  try {
    const fileBuffer = await fs.readFile(absoluteFilePath);
    return { receiptRecord, fileBuffer, absoluteFilePath };
  } catch {
    throw new OfflinePaymentReceiptFileMissingError(absoluteFilePath);
  }
}
