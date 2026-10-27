import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCollectedAmountTotals } from '../lib/adminTransactionTotals.js';

const TOTAL_OPTIONS = {
  localCurrencyCode: 'TZS',
  cryptoCurrencyCode: 'USDT',
  cryptoPaymentMethod: 'usdt_bep20',
};

test('buildCollectedAmountTotals sums only confirmed payments', () => {
  const collectedTotals = buildCollectedAmountTotals(
    [
      { payment_status: 'confirmed', payment_method: 'lipanamba', amount_expected: 10000 },
      { payment_status: 'confirmed', payment_method: 'azampesa', amount_expected: 15000 },
      { payment_status: 'pending', payment_method: 'lipanamba', amount_expected: 10000 },
      { payment_status: 'failed', payment_method: 'lipanamba', amount_expected: 10000 },
    ],
    TOTAL_OPTIONS
  );

  assert.deepEqual(collectedTotals, [
    { currencyCode: 'TZS', totalAmount: 25000 },
    { currencyCode: 'USDT', totalAmount: 0 },
  ]);
});

test('buildCollectedAmountTotals keeps TZS and USDT in separate totals', () => {
  const collectedTotals = buildCollectedAmountTotals(
    [
      { payment_status: 'confirmed', payment_method: 'lipanamba', amount_expected: 10000 },
      {
        payment_status: 'confirmed',
        payment_method: 'usdt_bep20',
        amount_expected: 5.5,
        amount_usdt: 5.5,
      },
      {
        payment_status: 'confirmed',
        payment_method: 'usdt_bep20',
        amount_expected: 4,
        amount_usdt: 4,
      },
    ],
    TOTAL_OPTIONS
  );

  assert.deepEqual(collectedTotals, [
    { currencyCode: 'TZS', totalAmount: 10000 },
    { currencyCode: 'USDT', totalAmount: 9.5 },
  ]);
});

test('buildCollectedAmountTotals falls back to amount_expected when the USDT order amount is missing', () => {
  const collectedTotals = buildCollectedAmountTotals(
    [
      {
        payment_status: 'confirmed',
        payment_method: 'usdt_bep20',
        amount_expected: 5.5,
        amount_usdt: null,
      },
    ],
    TOTAL_OPTIONS
  );

  assert.equal(collectedTotals[1].totalAmount, 5.5);
});

test('buildCollectedAmountTotals ignores amounts that are not numbers', () => {
  const collectedTotals = buildCollectedAmountTotals(
    [
      {
        payment_status: 'confirmed',
        payment_method: 'lipanamba',
        amount_expected: 'not-a-number',
      },
    ],
    TOTAL_OPTIONS
  );

  assert.equal(collectedTotals[0].totalAmount, 0);
});

test('buildCollectedAmountTotals returns both currency rows even when nothing was collected', () => {
  const collectedTotals = buildCollectedAmountTotals([], TOTAL_OPTIONS);

  assert.deepEqual(collectedTotals, [
    { currencyCode: 'TZS', totalAmount: 0 },
    { currencyCode: 'USDT', totalAmount: 0 },
  ]);
});
