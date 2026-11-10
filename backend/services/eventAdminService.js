import Joi from 'joi';

import pool from '../config/db.js';

import { fetchPrimaryEventConfiguration } from './eventConfigService.js';

import {
  EVENT_LIFECYCLE_STATUSES,
  buildEventConfigurationFromEventRecord,
  createEventRecordInDatabase,
  fetchAllEventRecordsFromDatabase,
  fetchEventRecordByIdFromDatabase,
  updateEventConfigurationInDatabase,
  updateEventLifecycleStatusInDatabase,
} from './eventRegistryService.js';

export class InvalidManagedEventInputError extends Error {
  constructor(detailsMessage) {
    super(`Invalid event input: ${detailsMessage}`);
    this.name = 'InvalidManagedEventInputError';
    this.code = 'INVALID_MANAGED_EVENT_INPUT';
    this.detailsMessage = detailsMessage;
  }
}

const eventConfigurationFields = {
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
  durationDays: Joi.number().integer().positive(),
  price: Joi.object({
    localCurrency: Joi.string().trim().max(8),
    localAmount: Joi.number().positive().precision(2),
    regularLocalAmount: Joi.number().positive().precision(2),
    cryptoCurrency: Joi.string().trim().max(12),
    cryptoNetwork: Joi.string().trim().max(20),
    cryptoAmount: Joi.number().positive().precision(8),
    regularCryptoAmount: Joi.number().positive().precision(8),
  }).unknown(false),
  seatCapacity: Joi.number().integer().positive(),
  seatHoldMinutes: Joi.number().integer().positive(),
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
    offlineReviewHoldMinutes: Joi.number().integer().positive(),
  }).unknown(false),
  paymentMethods: Joi.array().items(Joi.string().trim().min(2).max(40)).min(1),
  comingSoonPaymentMethods: Joi.array().items(Joi.string().trim().min(2).max(40)),
};

export const managedEventCreationJoiSchema = Joi.object({
  slug: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9][a-z0-9-]{1,99}$/)
    .required(),
  status: Joi.string()
    .valid(...EVENT_LIFECYCLE_STATUSES)
    .default('draft'),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().allow(null),
  ...eventConfigurationFields,
  name: eventConfigurationFields.name.required(),
}).unknown(false);

export const managedEventUpdateJoiSchema = Joi.object({
  status: Joi.string().valid(...EVENT_LIFECYCLE_STATUSES),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().allow(null),
  ...eventConfigurationFields,
})
  .unknown(false)
  .min(1);

function validateManagedEventInput(inputPayload, validationSchema) {
  const { error, value } = validationSchema.validate(inputPayload ?? {}, {
    abortEarly: false,
  });

  if (error) {
    const detailsMessage = error.details
      .map((detail) => detail.message)
      .join('; ');
    throw new InvalidManagedEventInputError(detailsMessage);
  }

  return value;
}

function mergeEventConfigurationWithDefaults(inputConfiguration) {
  const primaryEventConfiguration = fetchPrimaryEventConfiguration();
  const defaultConfiguration = JSON.parse(JSON.stringify(primaryEventConfiguration ?? {}));

  return {
    ...defaultConfiguration,
    ...inputConfiguration,
    event: {
      ...(defaultConfiguration.event ?? {}),
      ...(inputConfiguration.event ?? {}),
    },
    price: {
      ...(defaultConfiguration.price ?? {}),
      ...(inputConfiguration.price ?? {}),
    },
    contact: {
      ...(defaultConfiguration.contact ?? {}),
      ...(inputConfiguration.contact ?? {}),
    },
    payment: {
      ...(defaultConfiguration.payment ?? {}),
      ...(inputConfiguration.payment ?? {}),
    },
    paymentMethods:
      inputConfiguration.paymentMethods ?? defaultConfiguration.paymentMethods,
    comingSoonPaymentMethods:
      inputConfiguration.comingSoonPaymentMethods ??
      defaultConfiguration.comingSoonPaymentMethods,
  };
}

export async function createManagedEventRecord(inputPayload) {
  const validatedInput = validateManagedEventInput(
    inputPayload,
    managedEventCreationJoiSchema
  );

  const configuration = mergeEventConfigurationWithDefaults({
    ...validatedInput,
    slug: validatedInput.slug,
  });
  configuration.slug = validatedInput.slug;
  configuration.name = validatedInput.name;

  return createEventRecordInDatabase({
    slug: validatedInput.slug,
    name: validatedInput.name,
    status: validatedInput.status,
    startsAt: validatedInput.startsAt ?? null,
    endsAt: validatedInput.endsAt ?? null,
    configuration,
  });
}

export async function updateManagedEventRecord(eventId, inputPayload) {
  const validatedInput = validateManagedEventInput(
    inputPayload,
    managedEventUpdateJoiSchema
  );

  const existingEventRecord = await fetchEventRecordByIdFromDatabase(eventId);
  if (!existingEventRecord) {
    return null;
  }

  const existingConfiguration =
    buildEventConfigurationFromEventRecord(existingEventRecord);
  const nextConfiguration = mergeEventConfigurationWithDefaults({
    ...existingConfiguration,
    ...validatedInput,
  });
  nextConfiguration.slug = existingEventRecord.slug;
  nextConfiguration.name =
    validatedInput.name ?? existingConfiguration.name ?? existingEventRecord.name;

  let updatedEventRecord = await updateEventConfigurationInDatabase(
    eventId,
    nextConfiguration
  );

  if (validatedInput.status) {
    updatedEventRecord = await updateEventLifecycleStatusInDatabase(
      eventId,
      validatedInput.status
    );
  }

  return updatedEventRecord;
}

export async function fetchAdminEventListWithCapacity() {
  const eventRecords = await fetchAllEventRecordsFromDatabase();
  const capacityResult = await pool.query(
    `SELECT event_id,
            confirmed_count,
            cap,
            (SELECT COUNT(*)::INT
               FROM bookings
              WHERE bookings.event_id = event_seat_capacity.event_id) AS booking_count
       FROM event_seat_capacity`
  );
  const capacityByEventId = new Map(
    capacityResult.rows.map((capacityRow) => [
      Number(capacityRow.event_id),
      capacityRow,
    ])
  );

  return eventRecords.map((eventRecord) => {
    const capacityRow = capacityByEventId.get(eventRecord.id);
    return {
      ...eventRecord,
      confirmedCount: Number(capacityRow?.confirmed_count ?? 0),
      seatCapacity: Number(
        capacityRow?.cap ?? eventRecord.configuration?.seatCapacity ?? 150
      ),
      bookingCount: Number(capacityRow?.booking_count ?? 0),
    };
  });
}
