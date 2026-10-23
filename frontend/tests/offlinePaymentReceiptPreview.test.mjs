import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeOfflinePaymentReceiptMimeType,
  resolveOfflinePaymentReceiptFileExtension,
  resolveOfflinePaymentReceiptPreviewKind,
} from '../lib/offlinePaymentReceiptPreview.js';

test('resolveOfflinePaymentReceiptPreviewKind shows images inline', () => {
  assert.equal(resolveOfflinePaymentReceiptPreviewKind('image/jpeg'), 'image');
  assert.equal(resolveOfflinePaymentReceiptPreviewKind('image/png'), 'image');
  assert.equal(resolveOfflinePaymentReceiptPreviewKind('image/webp'), 'image');
});

test('resolveOfflinePaymentReceiptPreviewKind shows PDFs in a frame', () => {
  assert.equal(resolveOfflinePaymentReceiptPreviewKind('application/pdf'), 'pdf');
});

test('resolveOfflinePaymentReceiptPreviewKind refuses formats the browser cannot render', () => {
  assert.equal(resolveOfflinePaymentReceiptPreviewKind('application/zip'), 'unsupported');
  assert.equal(resolveOfflinePaymentReceiptPreviewKind(''), 'unsupported');
  assert.equal(resolveOfflinePaymentReceiptPreviewKind(undefined), 'unsupported');
});

test('resolveOfflinePaymentReceiptPreviewKind ignores a charset suffix and casing', () => {
  assert.equal(normalizeOfflinePaymentReceiptMimeType('IMAGE/PNG; charset=binary'), 'image/png');
  assert.equal(
    resolveOfflinePaymentReceiptPreviewKind('Application/PDF; charset=binary'),
    'pdf'
  );
});

test('resolveOfflinePaymentReceiptFileExtension keeps downloaded receipts openable', () => {
  assert.equal(resolveOfflinePaymentReceiptFileExtension('application/pdf'), 'pdf');
  assert.equal(resolveOfflinePaymentReceiptFileExtension('image/jpeg'), 'jpg');
  assert.equal(resolveOfflinePaymentReceiptFileExtension('image/png'), 'png');
  assert.equal(resolveOfflinePaymentReceiptFileExtension('image/webp'), 'webp');
  assert.equal(resolveOfflinePaymentReceiptFileExtension('application/octet-stream'), 'bin');
});
