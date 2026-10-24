import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSupabaseReceiptStorageService,
  SupabaseReceiptStorageError,
  SupabaseReceiptStorageObjectNotFoundError,
} from '../services/supabaseReceiptStorageService.js';

function createFakeSupabaseStorageClient({
  uploadError = null,
  downloadError = null,
  removeError = null,
  downloadedFile = Buffer.from('receipt file'),
} = {}) {
  const storageOperations = [];
  const storageClient = {
    storage: {
      from(bucketName) {
        storageOperations.push({ operation: 'select_bucket', bucketName });
        return {
          async upload(storageObjectPath, receiptFileBuffer, uploadOptions) {
            storageOperations.push({
              operation: 'upload',
              storageObjectPath,
              receiptFileBuffer,
              uploadOptions,
            });
            return { error: uploadError };
          },
          async download(storageObjectPath) {
            storageOperations.push({ operation: 'download', storageObjectPath });
            return {
              data: downloadError ? null : new Blob([downloadedFile]),
              error: downloadError,
            };
          },
          async remove(storageObjectPaths) {
            storageOperations.push({
              operation: 'remove',
              storageObjectPaths,
            });
            return { error: removeError };
          },
        };
      },
    },
  };

  return { storageClient, storageOperations };
}

function createReceiptStorageService(fakeStorageClient) {
  return createSupabaseReceiptStorageService({
    supabaseUrl: 'https://project-ref.supabase.co',
    supabaseSecretKey: 'server-only-test-secret',
    receiptBucketName: 'offline-payment-receipts',
    createSupabaseClientImplementation: () => fakeStorageClient,
  });
}

test('Supabase receipt storage uploads private receipt objects with their verified content type', async () => {
  const receiptFileBuffer = Buffer.from('receipt bytes');
  const { storageClient, storageOperations } = createFakeSupabaseStorageClient();
  const receiptStorageService = createReceiptStorageService(storageClient);

  await receiptStorageService.uploadOfflinePaymentReceiptObject(
    'receipts/receipt-123.png',
    receiptFileBuffer,
    'image/png'
  );

  assert.deepEqual(storageOperations, [
    {
      operation: 'select_bucket',
      bucketName: 'offline-payment-receipts',
    },
    {
      operation: 'upload',
      storageObjectPath: 'receipts/receipt-123.png',
      receiptFileBuffer,
      uploadOptions: { contentType: 'image/png', upsert: false },
    },
  ]);
});

test('Supabase receipt storage downloads bytes and removes replaced objects', async () => {
  const expectedReceiptFileBuffer = Buffer.from('private receipt bytes');
  const { storageClient, storageOperations } = createFakeSupabaseStorageClient({
    downloadedFile: expectedReceiptFileBuffer,
  });
  const receiptStorageService = createReceiptStorageService(storageClient);

  const downloadedReceiptFileBuffer =
    await receiptStorageService.downloadOfflinePaymentReceiptObject(
      'receipts/receipt-123.pdf'
    );
  await receiptStorageService.removeOfflinePaymentReceiptObject(
    'receipts/old-receipt.pdf'
  );

  assert.deepEqual(downloadedReceiptFileBuffer, expectedReceiptFileBuffer);
  assert.deepEqual(storageOperations.slice(1), [
    { operation: 'download', storageObjectPath: 'receipts/receipt-123.pdf' },
    {
      operation: 'remove',
      storageObjectPaths: ['receipts/old-receipt.pdf'],
    },
  ]);
});

test('Supabase receipt storage reports failed upload and download operations', async () => {
  const { storageClient: uploadStorageClient } = createFakeSupabaseStorageClient({
    uploadError: { message: 'upload denied', statusCode: '403' },
  });
  const uploadReceiptStorageService = createReceiptStorageService(uploadStorageClient);

  await assert.rejects(
    () =>
      uploadReceiptStorageService.uploadOfflinePaymentReceiptObject(
        'receipts/receipt.png',
        Buffer.from('receipt'),
        'image/png'
      ),
    (error) =>
      error instanceof SupabaseReceiptStorageError &&
      error.statusCode === '403' &&
      /upload denied/.test(error.message)
  );

  const { storageClient: downloadStorageClient } = createFakeSupabaseStorageClient({
    downloadError: { message: 'object missing', statusCode: '404' },
  });
  const downloadReceiptStorageService =
    createReceiptStorageService(downloadStorageClient);

  await assert.rejects(
    () =>
      downloadReceiptStorageService.downloadOfflinePaymentReceiptObject(
        'receipts/missing.png'
      ),
    (error) => error instanceof SupabaseReceiptStorageObjectNotFoundError
  );
});

test('Supabase receipt storage requires a project URL and a server-side secret key', () => {
  assert.throws(
    () =>
      createSupabaseReceiptStorageService({
        supabaseUrl: '',
        supabaseSecretKey: 'server-only-test-secret',
      }),
    /SUPABASE_URL is required/
  );

  assert.throws(
    () =>
      createSupabaseReceiptStorageService({
        supabaseUrl: 'https://project-ref.supabase.co',
        supabaseSecretKey: '',
      }),
    /SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required/
  );
});
