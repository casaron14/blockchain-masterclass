import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE,
  DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_DAY,
  DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP,
  GAS_SPONSORSHIP_DAILY_LIMIT_EXCEEDED,
  GAS_SPONSORSHIP_NOT_REQUIRED,
  GAS_SPONSORSHIP_PER_CYCLE_LIMIT_EXCEEDED,
  GAS_SPONSORSHIP_PER_SWEEP_LIMIT_EXCEEDED,
  GAS_SPONSORSHIP_WITHIN_LIMITS,
  evaluateGasSponsorshipDecision,
  fetchSponsoredBnbSpentInRollingWindow,
  resolveGasSponsorshipLimits,
} from '../services/gasSponsorshipPolicyService.js';

import {
  createBookingRecordWithActiveSeatHold,
} from '../services/bookingService.js';

import { createPendingPaymentRecordForBooking } from '../services/paymentService.js';

import { createOrderWithDepositAddressForBooking } from '../services/orderService.js';

const GAS_SPONSORSHIP_ENVIRONMENT_VARIABLES = [
  'GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP',
  'GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE',
  'GAS_SPONSORSHIP_MAX_BNB_PER_DAY',
  'GAS_SPONSORSHIP_SPEND_WINDOW_HOURS',
];

function clearGasSponsorshipEnvironmentVariables() {
  for (const variableName of GAS_SPONSORSHIP_ENVIRONMENT_VARIABLES) {
    delete process.env[variableName];
  }
}

beforeEach(async () => {
  clearGasSponsorshipEnvironmentVariables();
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
});

test('the sponsorship limits default to explicit per-sweep, per-cycle and per-day caps', () => {
  const limits = resolveGasSponsorshipLimits();

  assert.equal(
    limits.maxBnbPerSweepWei,
    ethers.parseEther(DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP)
  );
  assert.equal(
    limits.maxBnbPerCycleWei,
    ethers.parseEther(DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE)
  );
  assert.equal(
    limits.maxBnbPerDayWei,
    ethers.parseEther(DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_DAY)
  );
});

test('the sponsorship limits can be configured explicitly in BNB', () => {
  process.env.GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP = '0.001';
  process.env.GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE = '0.01';
  process.env.GAS_SPONSORSHIP_MAX_BNB_PER_DAY = '0.1';

  const limits = resolveGasSponsorshipLimits();

  assert.equal(limits.maxBnbPerSweepWei, ethers.parseEther('0.001'));
  assert.equal(limits.maxBnbPerCycleWei, ethers.parseEther('0.01'));
  assert.equal(limits.maxBnbPerDayWei, ethers.parseEther('0.1'));
});

test('an invalid sponsorship limit is rejected rather than silently defaulted', () => {
  process.env.GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP = 'five-thousand-satoshi';

  assert.throws(
    () => resolveGasSponsorshipLimits(),
    /GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP must be a decimal BNB amount/
  );
});

function buildLimits({
  maxBnbPerSweep = '0.005',
  maxBnbPerCycle = '0.05',
  maxBnbPerDay = '0.2',
} = {}) {
  return {
    maxBnbPerSweepWei: ethers.parseEther(maxBnbPerSweep),
    maxBnbPerCycleWei: ethers.parseEther(maxBnbPerCycle),
    maxBnbPerDayWei: ethers.parseEther(maxBnbPerDay),
  };
}

test('no funding request is always allowed and needs no budget', () => {
  const decision = evaluateGasSponsorshipDecision({
    requestedBnbWei: 0n,
    limits: buildLimits(),
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, GAS_SPONSORSHIP_NOT_REQUIRED);
});

test('a request inside every cap is allowed', () => {
  const decision = evaluateGasSponsorshipDecision({
    requestedBnbWei: ethers.parseEther('0.0005'),
    cycleSpentBnbWei: ethers.parseEther('0.001'),
    dailySpentBnbWei: ethers.parseEther('0.01'),
    limits: buildLimits(),
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, GAS_SPONSORSHIP_WITHIN_LIMITS);
});

test('a single sweep larger than the per-sweep cap is refused', () => {
  const decision = evaluateGasSponsorshipDecision({
    requestedBnbWei: ethers.parseEther('0.006'),
    limits: buildLimits(),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, GAS_SPONSORSHIP_PER_SWEEP_LIMIT_EXCEEDED);
});

test('a sweep that would exceed the cycle cap is refused', () => {
  const decision = evaluateGasSponsorshipDecision({
    requestedBnbWei: ethers.parseEther('0.004'),
    cycleSpentBnbWei: ethers.parseEther('0.047'),
    limits: buildLimits(),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, GAS_SPONSORSHIP_PER_CYCLE_LIMIT_EXCEEDED);
});

test('a sweep that would exceed the rolling day cap is refused', () => {
  const decision = evaluateGasSponsorshipDecision({
    requestedBnbWei: ethers.parseEther('0.004'),
    dailySpentBnbWei: ethers.parseEther('0.197'),
    limits: buildLimits(),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, GAS_SPONSORSHIP_DAILY_LIMIT_EXCEEDED);
});

test('sponsored BNB is summed over the rolling window and excludes older rows', async () => {
  const bookingRecord = await createBookingRecordWithActiveSeatHold({
    full_name: 'Sponsorship Spend User',
    email: 'sponsorship-spend@example.com',
    phone_number: '+255712345688',
  });
  await createPendingPaymentRecordForBooking(bookingRecord.id, 'usdt_bep20');
  const createdOrder = await createOrderWithDepositAddressForBooking(bookingRecord.id);

  await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, bnb_funded, bnb_funded_wei, status, created_at)
     VALUES ($1, $2, 3.8, $3, 0.00, $4, 'failed', now() - interval '2 hours'),
            ($1, $2, 3.8, $3, 0.00, $5, 'swept', now())`,
    [
      createdOrder.id,
      '0xDepositAddress0000000000000000000000000000005',
      ethers.parseUnits('3.8', 18).toString(),
      ethers.parseEther('0.002').toString(),
      ethers.parseEther('0.003').toString(),
    ]
  );
  await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, bnb_funded, bnb_funded_wei, status, created_at)
     VALUES ($1, $2, 3.8, $3, 0.00, $4, 'failed', now() - interval '30 hours')`,
    [
      createdOrder.id,
      '0xDepositAddress0000000000000000000000000000005',
      ethers.parseUnits('3.8', 18).toString(),
      ethers.parseEther('1.5').toString(),
    ]
  );

  const spentBnbWei = await fetchSponsoredBnbSpentInRollingWindow({ windowHours: 24 });

  assert.equal(spentBnbWei, ethers.parseEther('0.005'));
});
