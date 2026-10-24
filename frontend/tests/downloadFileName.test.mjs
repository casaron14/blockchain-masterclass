import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCsvDownloadFileName } from '../lib/downloadFileName.js';

test('resolveCsvDownloadFileName reads a quoted filename from Content-Disposition', () => {
  assert.equal(
    resolveCsvDownloadFileName(
      'attachment; filename="bookings-2026-10-24.csv"',
      'bookings.csv'
    ),
    'bookings-2026-10-24.csv'
  );
});

test('resolveCsvDownloadFileName reads an RFC 5987 encoded filename', () => {
  assert.equal(
    resolveCsvDownloadFileName(
      "attachment; filename*=UTF-8''referred-clients-ref_neema_x7k2-2026-10-24.csv",
      'fallback.csv'
    ),
    'referred-clients-ref_neema_x7k2-2026-10-24.csv'
  );
});

test('resolveCsvDownloadFileName falls back when the header is missing', () => {
  assert.equal(resolveCsvDownloadFileName(null, 'referral-summary.csv'), 'referral-summary.csv');
  assert.equal(resolveCsvDownloadFileName('', 'bookings.csv'), 'bookings.csv');
});
