import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAdminAmount,
  formatAdminAmountWithCurrency,
  formatAdminStatusLabel,
  formatAdminTimestamp,
} from '../lib/adminFormatting.js';

test('formatAdminTimestamp renders an unambiguous institutional timestamp', () => {
  const localTimestamp = new Date(2026, 9, 18, 9, 24);
  assert.equal(formatAdminTimestamp(localTimestamp), '18 Oct 2026 · 09:24');
});

test('formatAdminTimestamp returns a dash for missing or unparseable timestamps', () => {
  assert.equal(formatAdminTimestamp(null), '—');
  assert.equal(formatAdminTimestamp(''), '—');
  assert.equal(formatAdminTimestamp('not-a-date'), '—');
});

test('formatAdminAmount groups thousands and keeps crypto decimals', () => {
  assert.equal(formatAdminAmount(10000), '10,000');
  assert.equal(formatAdminAmount('3.8'), '3.8');
  assert.equal(formatAdminAmount(undefined), '—');
});

test('formatAdminAmountWithCurrency separates the currency code from the grouped amount', () => {
  assert.equal(formatAdminAmountWithCurrency(10000, 'TZS'), 'TZS 10,000');
  assert.equal(formatAdminAmountWithCurrency(10000, ''), '10,000');
  assert.equal(formatAdminAmountWithCurrency('not-a-number', 'TZS'), '—');
});

test('formatAdminStatusLabel turns stored status values into read labels', () => {
  assert.equal(formatAdminStatusLabel('confirmed'), 'Confirmed');
  assert.equal(formatAdminStatusLabel('usdt_bep20'), 'Usdt Bep20');
  assert.equal(formatAdminStatusLabel(null), '—');
});
