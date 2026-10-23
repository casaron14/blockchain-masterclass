// The admin reviews an uploaded Lipa Namba receipt in the browser instead of
// downloading it first. These helpers decide how a stored receipt can be shown
// so the detail page never hands an unsupported file to a viewer.

const OFFLINE_PAYMENT_RECEIPT_FILE_EXTENSIONS_BY_MIME_TYPE = Object.freeze({
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

const OFFLINE_PAYMENT_RECEIPT_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export function normalizeOfflinePaymentReceiptMimeType(receiptMimeType) {
  if (typeof receiptMimeType !== 'string') {
    return '';
  }

  return receiptMimeType.split(';')[0].trim().toLowerCase();
}

export function resolveOfflinePaymentReceiptFileExtension(receiptMimeType) {
  const normalizedMimeType = normalizeOfflinePaymentReceiptMimeType(receiptMimeType);
  return OFFLINE_PAYMENT_RECEIPT_FILE_EXTENSIONS_BY_MIME_TYPE[normalizedMimeType] || 'bin';
}

export function resolveOfflinePaymentReceiptPreviewKind(receiptMimeType) {
  const normalizedMimeType = normalizeOfflinePaymentReceiptMimeType(receiptMimeType);

  if (normalizedMimeType === 'application/pdf') {
    return 'pdf';
  }

  if (OFFLINE_PAYMENT_RECEIPT_IMAGE_MIME_TYPES.includes(normalizedMimeType)) {
    return 'image';
  }

  return 'unsupported';
}
