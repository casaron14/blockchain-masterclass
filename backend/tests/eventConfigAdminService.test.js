import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  fetchPrimaryEventConfiguration,
  SEAT_CAPACITY,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
} from '../services/eventConfigService.js';

import {
  fetchEffectiveEventConfiguration,
  fetchLiveSeatCapacitySnapshot,
  saveEventConfigurationOverrides,
  resolveEffectiveExpectedAmountForPaymentMethod,
  InvalidEventConfigOverrideError,
  SeatCapacityBelowConfirmedCountError,
} from '../services/eventConfigAdminService.js';

async function resetConfigurationAndCapacityState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('DELETE FROM event_config_overrides');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0, cap = $1 WHERE id = 1', [
    SEAT_CAPACITY,
  ]);
}

beforeEach(resetConfigurationAndCapacityState);
afterEach(resetConfigurationAndCapacityState);

test('fetchEffectiveEventConfiguration returns the static configuration when no override row exists', async () => {
  const staticConfiguration = fetchPrimaryEventConfiguration();
  const effectiveConfiguration = await fetchEffectiveEventConfiguration();

  assert.deepEqual(effectiveConfiguration, staticConfiguration);
});

test('saveEventConfigurationOverrides persists overrides visible to the effective configuration', async () => {
  const savedReport = await saveEventConfigurationOverrides({
    name: 'Blockchain Masterclass 2026',
    event: { date: 'December 5, 2026' },
    price: { localAmount: 30000, cryptoAmount: 15 },
  });

  assert.equal(savedReport.configuration.name, 'Blockchain Masterclass 2026');
  assert.equal(savedReport.configuration.event.date, 'December 5, 2026');
  assert.equal(savedReport.configuration.price.localAmount, 30000);
  assert.equal(savedReport.configuration.price.cryptoAmount, 15);

  const effectiveConfiguration = await fetchEffectiveEventConfiguration();
  assert.equal(effectiveConfiguration.price.localAmount, 30000);
  assert.equal(effectiveConfiguration.price.cryptoAmount, 15);
});

test('saveEventConfigurationOverrides persists Lipa Namba payment details', async () => {
  const savedReport = await saveEventConfigurationOverrides({
    payment: {
      lipaNambaNumber: '+255 700 000 000',
      lipaNambaAccountName: 'Masterclass Collections',
    },
  });

  assert.equal(savedReport.configuration.payment.lipaNambaNumber, '+255 700 000 000');
  assert.equal(
    savedReport.configuration.payment.lipaNambaAccountName,
    'Masterclass Collections'
  );

  const effectiveConfiguration = await fetchEffectiveEventConfiguration();
  assert.equal(effectiveConfiguration.payment.lipaNambaNumber, '+255 700 000 000');
  assert.equal(
    effectiveConfiguration.payment.offlineReviewHoldMinutes,
    1440
  );
});

test('seat capacity override syncs the enforced seat_capacity cap', async () => {
  const savedReport = await saveEventConfigurationOverrides({ seatCapacity: 125 });

  assert.equal(savedReport.configuration.seatCapacity, 125);

  const liveSeatCapacity = await fetchLiveSeatCapacitySnapshot();
  assert.equal(liveSeatCapacity.cap, 125);
});

test('seat capacity override below confirmed count is rejected without changing the cap', async () => {
  await pool.query('UPDATE seat_capacity SET confirmed_count = 3 WHERE id = 1');
  await saveEventConfigurationOverrides({ seatCapacity: 125 });

  await assert.rejects(
    saveEventConfigurationOverrides({ seatCapacity: 2 }),
    (error) => {
      assert.ok(error instanceof SeatCapacityBelowConfirmedCountError);
      assert.equal(error.code, 'SEAT_CAPACITY_BELOW_CONFIRMED_COUNT');
      assert.equal(error.confirmedCount, 3);
      return true;
    }
  );

  const liveSeatCapacity = await fetchLiveSeatCapacitySnapshot();
  assert.equal(liveSeatCapacity.cap, 125);
  assert.equal(liveSeatCapacity.confirmedCount, 3);
});

test('resolveEffectiveExpectedAmountForPaymentMethod follows overridden prices for new payments', async () => {
  await saveEventConfigurationOverrides({
    price: { localAmount: 35000, cryptoAmount: 20 },
  });

  assert.equal(await resolveEffectiveExpectedAmountForPaymentMethod('azampesa'), 35000);
  assert.equal(await resolveEffectiveExpectedAmountForPaymentMethod('usdt_bep20'), 20);
});

test('resolveEffectiveExpectedAmountForPaymentMethod falls back to static prices without overrides', async () => {
  assert.equal(await resolveEffectiveExpectedAmountForPaymentMethod('azampesa'), TICKET_PRICE_TZS);
  assert.equal(await resolveEffectiveExpectedAmountForPaymentMethod('usdt_bep20'), TICKET_PRICE_USDT);
});

test('saveEventConfigurationOverrides rejects empty, read-only, and invalid override payloads', async () => {
  await assert.rejects(
    saveEventConfigurationOverrides({}),
    (error) => error instanceof InvalidEventConfigOverrideError
  );

  await assert.rejects(
    saveEventConfigurationOverrides({ slug: 'other-event' }),
    (error) => error instanceof InvalidEventConfigOverrideError
  );

  await assert.rejects(
    saveEventConfigurationOverrides({ paymentMethods: ['azampesa'] }),
    (error) => error instanceof InvalidEventConfigOverrideError
  );

  await assert.rejects(
    saveEventConfigurationOverrides({ price: { localAmount: -5 } }),
    (error) => error instanceof InvalidEventConfigOverrideError
  );

  await assert.rejects(
    saveEventConfigurationOverrides({ name: 'x' }),
    (error) => error instanceof InvalidEventConfigOverrideError
  );
});