import pool from '../config/db.js';

import Joi from 'joi';

import {
  PRIMARY_EVENT_SLUG,
  fetchEventConfigurationBySlug,
  PAYMENT_METHOD_USDT_BEP20,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
} from './eventConfigService.js';

import { SEAT_CAPACITY_ROW_ID } from './bookingService.js';

export const eventConfigOverrideJoiSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  tagline: Joi.string().trim().max(200),
  event: Joi.object({
    date: Joi.string().trim().max(120),
    location: Joi.string().trim().max(200),
  }).unknown(false),
  price: Joi.object({
    localAmount: Joi.number().positive().precision(2),
    cryptoAmount: Joi.number().positive().precision(8),
    regularLocalAmount: Joi.number().positive().precision(2),
    regularCryptoAmount: Joi.number().positive().precision(8),
  }).unknown(false),
  seatCapacity: Joi.number().integer().positive(),
  phonePlaceholder: Joi.string().trim().max(60),
  contact: Joi.object({
    supportEmail: Joi.string().trim().email(),
    supportPhone: Joi.string().trim().max(40),
    addressLine1: Joi.string().trim().max(200),
    addressLine2: Joi.string().trim().max(200),
    platformName: Joi.string().trim().max(120),
  }).unknown(false),
  payment: Joi.object({
    lipaNambaNumber: Joi.string()
      .trim()
      .pattern(/^[0-9+\s-]{5,40}$/)
      .messages({
        'string.pattern.base': 'Lipa Namba number contains unsupported characters',
      }),
    lipaNambaAccountName: Joi.string().trim().max(120),
  }).unknown(false),
})
  .unknown(false)
  .min(1);

export class InvalidEventConfigOverrideError extends Error {
  constructor(detailsMessage) {
    super(`Invalid event configuration overrides: ${detailsMessage}`);
    this.name = 'InvalidEventConfigOverrideError';
    this.code = 'INVALID_EVENT_CONFIG_OVERRIDE';
    this.detailsMessage = detailsMessage;
  }
}

export class SeatCapacityBelowConfirmedCountError extends Error {
  constructor(requestedCapacity, confirmedCount) {
    super(
      `Requested seat capacity ${requestedCapacity} is below the ${confirmedCount} confirmed seats`
    );
    this.name = 'SeatCapacityBelowConfirmedCountError';
    this.code = 'SEAT_CAPACITY_BELOW_CONFIRMED_COUNT';
    this.requestedCapacity = requestedCapacity;
    this.confirmedCount = confirmedCount;
  }
}

export async function fetchEventConfigurationOverridesFromDatabase(
  eventSlug = PRIMARY_EVENT_SLUG
) {
  const result = await pool.query(
    'SELECT slug, overrides, updated_at FROM event_config_overrides WHERE slug = $1',
    [eventSlug]
  );
  return result.rows[0] ?? null;
}

export async function fetchEffectiveEventConfiguration(eventSlug = PRIMARY_EVENT_SLUG) {
  const baseConfiguration = fetchEventConfigurationBySlug(eventSlug);
  if (!baseConfiguration) {
    return null;
  }

  const overrideRow = await fetchEventConfigurationOverridesFromDatabase(eventSlug);
  return mergeEffectiveEventConfiguration(baseConfiguration, overrideRow?.overrides ?? null);
}

export async function fetchLiveSeatCapacitySnapshot() {
  const result = await pool.query(
    'SELECT confirmed_count, cap FROM seat_capacity WHERE id = $1',
    [SEAT_CAPACITY_ROW_ID]
  );
  const capacityRow = result.rows[0];
  return {
    confirmedCount: Number(capacityRow.confirmed_count),
    cap: Number(capacityRow.cap),
  };
}

export async function resolveEffectiveExpectedAmountForPaymentMethod(paymentMethod) {
  const effectiveConfiguration = await fetchEffectiveEventConfiguration();
  if (!effectiveConfiguration?.price) {
    throw new Error('Effective event configuration unavailable');
  }

  if (paymentMethod === PAYMENT_METHOD_USDT_BEP20) {
    return typeof effectiveConfiguration.price.cryptoAmount === 'number'
      ? effectiveConfiguration.price.cryptoAmount
      : TICKET_PRICE_USDT;
  }

  return typeof effectiveConfiguration.price.localAmount === 'number'
    ? effectiveConfiguration.price.localAmount
    : TICKET_PRICE_TZS;
}

export async function saveEventConfigurationOverrides(overridePayload) {
  const validatedOverrides = validateAndNormalizeEventConfigOverrides(overridePayload);

  if (typeof validatedOverrides.seatCapacity === 'number') {
    await applySeatCapacityChange(validatedOverrides.seatCapacity);
  }

  await pool.query(
    `INSERT INTO event_config_overrides (slug, overrides, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (slug)
     DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = now()`,
    [PRIMARY_EVENT_SLUG, JSON.stringify(validatedOverrides)]
  );

  return buildEventConfigurationReport();
}

async function buildEventConfigurationReport() {
  const configuration = await fetchEffectiveEventConfiguration();
  const liveSeatCapacity = await fetchLiveSeatCapacitySnapshot();
  const overrideRow = await fetchEventConfigurationOverridesFromDatabase();

  return {
    configuration,
    liveSeatCapacity,
    updatedAt: overrideRow?.updated_at ?? null,
  };
}

function validateAndNormalizeEventConfigOverrides(overridePayload) {
  const { error, value } = eventConfigOverrideJoiSchema.validate(overridePayload ?? {}, {
    abortEarly: false,
  });

  if (error) {
    const detailsMessage = error.details.map((detail) => detail.message).join('; ');
    throw new InvalidEventConfigOverrideError(detailsMessage);
  }

  return value;
}

function mergeEffectiveEventConfiguration(baseConfiguration, overrideValues) {
  if (!overrideValues || typeof overrideValues !== 'object') {
    return baseConfiguration;
  }

  return {
    ...baseConfiguration,
    ...overrideValues,
    event: { ...baseConfiguration.event, ...(overrideValues.event ?? {}) },
    price: { ...baseConfiguration.price, ...(overrideValues.price ?? {}) },
    contact: { ...baseConfiguration.contact, ...(overrideValues.contact ?? {}) },
    payment: { ...baseConfiguration.payment, ...(overrideValues.payment ?? {}) },
  };
}

async function applySeatCapacityChange(newCapacity) {
  const capacityClient = await pool.connect();

  try {
    await capacityClient.query('BEGIN');
    const confirmedSeatsResult = await capacityClient.query(
      'SELECT confirmed_count FROM seat_capacity WHERE id = $1 FOR UPDATE',
      [SEAT_CAPACITY_ROW_ID]
    );
    const currentConfirmedCount = Number(confirmedSeatsResult.rows[0].confirmed_count);

    if (newCapacity < currentConfirmedCount) {
      throw new SeatCapacityBelowConfirmedCountError(newCapacity, currentConfirmedCount);
    }

    await capacityClient.query('UPDATE seat_capacity SET cap = $1 WHERE id = $2', [
      newCapacity,
      SEAT_CAPACITY_ROW_ID,
    ]);
    await capacityClient.query('COMMIT');
  } catch (error) {
    await capacityClient.query('ROLLBACK');
    throw error;
  } finally {
    capacityClient.release();
  }
}