import pool from '../config/db.js';

import Joi from 'joi';

import {
  PRIMARY_EVENT_SLUG,
  fetchEventConfigurationBySlug,
  PAYMENT_METHOD_USDT_BEP20,
  TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
} from './eventConfigService.js';

import {
  buildEventConfigurationFromEventRecord,
  ensureEventSeatCapacityRowExistsForEventRecord,
  fetchEventRecordByIdFromDatabase,
  fetchEventRecordBySlugFromDatabase,
  resolveDefaultPublicEventRecordFromDatabase,
  updateEventConfigurationInDatabase,
} from './eventRegistryService.js';

export const eventConfigOverrideJoiSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  tagline: Joi.string().trim().max(200),
  event: Joi.object({
    date: Joi.string().trim().max(120),
    ticketDateLabel: Joi.string().trim().max(40),
    location: Joi.string().trim().max(200),
    venueName: Joi.string().trim().max(200),
    motto: Joi.string().trim().max(200),
    brandName: Joi.string().trim().max(120),
    websiteAddress: Joi.string().trim().max(200),
    timeLabel: Joi.string().trim().max(120),
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
    brandName: Joi.string().trim().max(120),
    websiteAddress: Joi.string().trim().max(200),
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

export class EventConfigurationNotFoundError extends Error {
  constructor(eventSlug) {
    super(`Event configuration not found for ${eventSlug}`);
    this.name = 'EventConfigurationNotFoundError';
    this.code = 'EVENT_CONFIGURATION_NOT_FOUND';
  }
}

async function resolveAdminTargetEventRecord(eventSlug) {
  if (eventSlug) {
    return fetchEventRecordBySlugFromDatabase(eventSlug);
  }

  return resolveDefaultPublicEventRecordFromDatabase();
}

export async function fetchEventConfigurationOverridesFromDatabase(eventSlug = null) {
  const eventRecord = await resolveAdminTargetEventRecord(eventSlug);
  if (!eventRecord) {
    return null;
  }

  return {
    slug: eventRecord.slug,
    overrides: buildEventConfigurationFromEventRecord(eventRecord),
    updated_at: eventRecord.updated_at,
  };
}

export async function fetchEffectiveEventConfiguration(eventSlug = null) {
  const eventRecord = await resolveAdminTargetEventRecord(eventSlug);
  if (eventRecord) {
    return buildEventConfigurationFromEventRecord(eventRecord);
  }

  return fetchEventConfigurationBySlug(eventSlug ?? PRIMARY_EVENT_SLUG);
}

export async function fetchLiveSeatCapacitySnapshot(eventSlug) {
  const eventRecord = eventSlug
    ? await fetchEventRecordBySlugFromDatabase(eventSlug)
    : await resolveDefaultPublicEventRecordFromDatabase();

  if (!eventRecord) {
    return {
      confirmedCount: 0,
      cap: 150,
    };
  }

  await ensureEventSeatCapacityRowExistsForEventRecord(pool, eventRecord);

  const result = await pool.query(
    `SELECT confirmed_count, cap
       FROM event_seat_capacity
      WHERE event_id = $1`,
    [eventRecord.id]
  );
  const capacityRow = result.rows[0];

  return {
    confirmedCount: Number(capacityRow?.confirmed_count ?? 0),
    cap: Number(capacityRow?.cap ?? eventRecord.configuration?.seatCapacity ?? 150),
  };
}

export async function resolveEffectiveExpectedAmountForPaymentMethod(
  paymentMethod,
  eventReference = PRIMARY_EVENT_SLUG
) {
  const effectiveConfiguration = await resolveEventConfigurationForAmount(eventReference);
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

async function resolveEventConfigurationForAmount(eventReference) {
  if (!eventReference) {
    return fetchEffectiveEventConfiguration();
  }

  if (typeof eventReference === 'string') {
    return fetchEffectiveEventConfiguration(eventReference);
  }

  if (eventReference.configuration && eventReference.slug) {
    return buildEventConfigurationFromEventRecord(eventReference);
  }

  if (eventReference.price) {
    return eventReference;
  }

  if (eventReference.eventId) {
    const eventRecord = await fetchEventRecordByIdFromDatabase(eventReference.eventId);
    return eventRecord ? buildEventConfigurationFromEventRecord(eventRecord) : null;
  }

  return null;
}

export async function saveEventConfigurationOverrides(
  overridePayload,
  eventSlug = null
) {
  const validatedOverrides = validateAndNormalizeEventConfigOverrides(overridePayload);
  const eventRecord = await resolveAdminTargetEventRecord(eventSlug);
  if (!eventRecord) {
    throw new EventConfigurationNotFoundError(eventSlug ?? 'default');
  }

  if (typeof validatedOverrides.seatCapacity === 'number') {
    await applySeatCapacityChangeToEvent(eventRecord.id, validatedOverrides.seatCapacity);
  }

  const currentConfiguration = buildEventConfigurationFromEventRecord(eventRecord);
  const nextConfiguration = mergeEffectiveEventConfiguration(
    currentConfiguration,
    validatedOverrides
  );

  await updateEventConfigurationInDatabase(eventRecord.id, nextConfiguration);

  return buildEventConfigurationReport(eventSlug);
}

export async function buildEventConfigurationReport(eventSlug = null) {
  const configuration = await fetchEffectiveEventConfiguration(eventSlug);
  const liveSeatCapacity = await fetchLiveSeatCapacitySnapshot(eventSlug);
  const overrideRow = await fetchEventConfigurationOverridesFromDatabase(eventSlug);

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

async function applySeatCapacityChangeToEvent(eventId, newCapacity) {
  const capacityClient = await pool.connect();

  try {
    await capacityClient.query('BEGIN');

    const eventRecordResult = await capacityClient.query(
      'SELECT * FROM events WHERE id = $1 FOR UPDATE',
      [eventId]
    );
    const eventRecord = eventRecordResult.rows[0];
    if (!eventRecord) {
      throw new EventConfigurationNotFoundError(eventId);
    }

    await ensureEventSeatCapacityRowExistsForEventRecord(capacityClient, {
      ...eventRecord,
      id: Number(eventRecord.id),
    });

    const confirmedSeatsResult = await capacityClient.query(
      'SELECT confirmed_count FROM event_seat_capacity WHERE event_id = $1 FOR UPDATE',
      [eventId]
    );
    const currentConfirmedCount = Number(
      confirmedSeatsResult.rows[0]?.confirmed_count ?? 0
    );

    if (newCapacity < currentConfirmedCount) {
      throw new SeatCapacityBelowConfirmedCountError(
        newCapacity,
        currentConfirmedCount
      );
    }

    await capacityClient.query(
      'UPDATE event_seat_capacity SET cap = $1 WHERE event_id = $2',
      [newCapacity, eventId]
    );
    await capacityClient.query(
      `UPDATE events
          SET configuration = jsonb_set(
                configuration,
                '{seatCapacity}',
                to_jsonb($1::INTEGER),
                true
              ),
              updated_at = now()
        WHERE id = $2`,
      [newCapacity, eventId]
    );

    await capacityClient.query('COMMIT');
  } catch (error) {
    await capacityClient.query('ROLLBACK');
    throw error;
  } finally {
    capacityClient.release();
  }
}
