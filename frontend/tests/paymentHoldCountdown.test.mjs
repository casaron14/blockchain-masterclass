import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPaymentHoldCountdown } from '../lib/paymentHoldCountdown.js';

const ONE_SECOND_IN_MILLISECONDS = 1000;
const ONE_MINUTE_IN_MILLISECONDS = 60 * ONE_SECOND_IN_MILLISECONDS;
const ONE_HOUR_IN_MILLISECONDS = 60 * ONE_MINUTE_IN_MILLISECONDS;

test('formats a 24-hour offline review hold with an hour field instead of 1438 minutes', () => {
  const remainingMilliseconds =
    23 * ONE_HOUR_IN_MILLISECONDS +
    58 * ONE_MINUTE_IN_MILLISECONDS +
    35 * ONE_SECOND_IN_MILLISECONDS;

  assert.equal(formatPaymentHoldCountdown(remainingMilliseconds), '23:58:35');
});

test('keeps the compact minute and second format for the normal one-hour hold', () => {
  const remainingMilliseconds =
    59 * ONE_MINUTE_IN_MILLISECONDS + 59 * ONE_SECOND_IN_MILLISECONDS;

  assert.equal(formatPaymentHoldCountdown(remainingMilliseconds), '59:59');
});

test('adds the hour field as soon as the hold reaches one hour', () => {
  assert.equal(formatPaymentHoldCountdown(ONE_HOUR_IN_MILLISECONDS), '1:00:00');
});

test('pads minutes and seconds when the hold has hours', () => {
  const remainingMilliseconds =
    ONE_HOUR_IN_MILLISECONDS +
    ONE_MINUTE_IN_MILLISECONDS +
    ONE_SECOND_IN_MILLISECONDS;

  assert.equal(formatPaymentHoldCountdown(remainingMilliseconds), '1:01:01');
});

test('never shows a negative countdown after the hold expires', () => {
  assert.equal(formatPaymentHoldCountdown(-5 * ONE_MINUTE_IN_MILLISECONDS), '00:00');
});

test('treats a missing or invalid countdown value as expired', () => {
  assert.equal(formatPaymentHoldCountdown(Number.NaN), '00:00');
  assert.equal(formatPaymentHoldCountdown(undefined), '00:00');
});
