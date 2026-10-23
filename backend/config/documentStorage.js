// Serverless platforms give the function a read-only filesystem apart from
// /tmp, and that /tmp is discarded between invocations. Documents (tickets,
// receipts) are therefore rendered into memory there and never persisted; the
// database remains the source of truth and every download re-renders.
export const DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM = 'local';
export const DOCUMENT_STORAGE_MODE_IN_MEMORY = 'memory';

export function resolveDocumentStorageMode() {
  const configuredMode = String(process.env.DOCUMENT_STORAGE_MODE || '').toLowerCase();

  if (
    configuredMode === DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM ||
    configuredMode === DOCUMENT_STORAGE_MODE_IN_MEMORY
  ) {
    return configuredMode;
  }

  return process.env.VERCEL === '1'
    ? DOCUMENT_STORAGE_MODE_IN_MEMORY
    : DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM;
}

export function isLocalDocumentStorageEnabled() {
  return resolveDocumentStorageMode() === DOCUMENT_STORAGE_MODE_LOCAL_FILE_SYSTEM;
}
