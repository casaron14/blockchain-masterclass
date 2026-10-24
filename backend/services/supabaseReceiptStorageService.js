import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_RECEIPT_BUCKET_NAME = 'offline-payment-receipts';

export class SupabaseReceiptStorageError extends Error {
  constructor(operationName, reasonMessage, statusCode = null) {
    super(`Supabase Storage ${operationName} failed: ${reasonMessage}`);
    this.name = 'SupabaseReceiptStorageError';
    this.code = 'SUPABASE_RECEIPT_STORAGE_FAILED';
    this.statusCode = statusCode;
  }
}

export class SupabaseReceiptStorageObjectNotFoundError extends Error {
  constructor(storageObjectPath) {
    super(`Supabase Storage receipt object was not found: ${storageObjectPath}`);
    this.name = 'SupabaseReceiptStorageObjectNotFoundError';
    this.code = 'SUPABASE_RECEIPT_STORAGE_OBJECT_NOT_FOUND';
  }
}

export function createSupabaseReceiptStorageService({
  supabaseUrl,
  supabaseSecretKey,
  receiptBucketName = DEFAULT_SUPABASE_RECEIPT_BUCKET_NAME,
  createSupabaseClientImplementation = createClient,
}) {
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required for Supabase receipt storage');
  }
  if (!supabaseSecretKey) {
    throw new Error(
      'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required for Supabase receipt storage'
    );
  }
  if (!receiptBucketName) {
    throw new Error('SUPABASE_RECEIPT_BUCKET is required for Supabase receipt storage');
  }

  const supabaseClient = createSupabaseClientImplementation(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }
  );
  const receiptBucket = supabaseClient.storage.from(receiptBucketName);

  async function uploadOfflinePaymentReceiptObject(
    storageObjectPath,
    receiptFileBuffer,
    mimeType
  ) {
    const { error } = await receiptBucket.upload(storageObjectPath, receiptFileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) {
      throw new SupabaseReceiptStorageError('upload', error.message, error.statusCode);
    }
  }

  async function downloadOfflinePaymentReceiptObject(storageObjectPath) {
    const { data, error } = await receiptBucket.download(storageObjectPath);

    if (error) {
      if (String(error.statusCode) === '404') {
        throw new SupabaseReceiptStorageObjectNotFoundError(storageObjectPath);
      }
      throw new SupabaseReceiptStorageError('download', error.message, error.statusCode);
    }

    if (!data) {
      throw new SupabaseReceiptStorageError(
        'download',
        'the response did not contain a file'
      );
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async function removeOfflinePaymentReceiptObject(storageObjectPath) {
    const { error } = await receiptBucket.remove([storageObjectPath]);
    if (error) {
      throw new SupabaseReceiptStorageError('remove', error.message, error.statusCode);
    }
  }

  return {
    uploadOfflinePaymentReceiptObject,
    downloadOfflinePaymentReceiptObject,
    removeOfflinePaymentReceiptObject,
  };
}

let configuredSupabaseReceiptStorageService;

function resolveConfiguredSupabaseReceiptStorageService() {
  if (configuredSupabaseReceiptStorageService) {
    return configuredSupabaseReceiptStorageService;
  }

  configuredSupabaseReceiptStorageService = createSupabaseReceiptStorageService({
    supabaseUrl: process.env.SUPABASE_URL?.trim(),
    supabaseSecretKey:
      process.env.SUPABASE_SECRET_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    receiptBucketName:
      process.env.SUPABASE_RECEIPT_BUCKET?.trim() ||
      DEFAULT_SUPABASE_RECEIPT_BUCKET_NAME,
  });

  return configuredSupabaseReceiptStorageService;
}

export async function uploadOfflinePaymentReceiptObject(
  storageObjectPath,
  receiptFileBuffer,
  mimeType
) {
  return resolveConfiguredSupabaseReceiptStorageService().uploadOfflinePaymentReceiptObject(
    storageObjectPath,
    receiptFileBuffer,
    mimeType
  );
}

export async function downloadOfflinePaymentReceiptObject(storageObjectPath) {
  return resolveConfiguredSupabaseReceiptStorageService().downloadOfflinePaymentReceiptObject(
    storageObjectPath
  );
}

export async function removeOfflinePaymentReceiptObject(storageObjectPath) {
  return resolveConfiguredSupabaseReceiptStorageService().removeOfflinePaymentReceiptObject(
    storageObjectPath
  );
}
