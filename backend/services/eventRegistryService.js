import pool from '../config/db.js';

import {
  PRIMARY_EVENT_SLUG,
  fetchEventConfigurationBySlug,
  fetchPrimaryEventConfiguration,
} from './eventConfigService.js';

export const EVENT_LIFECYCLE_STATUSES = Object.freeze([
  'draft',
  'open',
  'closed',
  'archived',
]);

const DEFAULT_EVENT_SEAT_CAPACITY = 150;

export class EventNotFoundError extends Error {
  constructor(eventIdentifier) {
    super(`Event not found for ${eventIdentifier}`);
    this.name = 'EventNotFoundError';
    this.code = 'EVENT_NOT_FOUND';
  }
}

export class EventNotOpenForBookingError extends Error {
  constructor(eventSlug, eventStatus) {
    super(`Event ${eventSlug} is not open for booking (current status: ${eventStatus})`);
    this.name = 'EventNotOpenForBookingError';
    this.code = 'EVENT_NOT_OPEN_FOR_BOOKING';
    this.eventSlug = eventSlug;
    this.eventStatus = eventStatus;
  }
}

export class EventSlugAlreadyExistsError extends Error {
  constructor(eventSlug) {
    super(`An event already exists for slug ${eventSlug}`);
    this.name = 'EventSlugAlreadyExistsError';
    this.code = 'EVENT_SLUG_ALREADY_EXISTS';
  }
}

export class InvalidEventLifecycleStatusError extends Error {
  constructor(eventStatus) {
    super(`Unsupported event lifecycle status: ${eventStatus}`);
    this.name = 'InvalidEventLifecycleStatusError';
    this.code = 'INVALID_EVENT_LIFECYCLE_STATUS';
  }
}

function normalizeEventRecord(eventRow) {
  if (!eventRow) {
    return null;
  }

  return {
    ...eventRow,
    id: Number(eventRow.id),
  };
}

export async function fetchEventRecordBySlugFromDatabase(eventSlug) {
  const result = await pool.query('SELECT * FROM events WHERE slug = $1', [eventSlug]);
  return normalizeEventRecord(result.rows[0]);
}

export async function fetchEventRecordByIdFromDatabase(eventId) {
  const result = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
  return normalizeEventRecord(result.rows[0]);
}

export async function fetchAllEventRecordsFromDatabase() {
  const result = await pool.query(
    `SELECT * FROM events
      ORDER BY
        CASE status
          WHEN 'open' THEN 0
          WHEN 'draft' THEN 1
          WHEN 'closed' THEN 2
          ELSE 3
        END,
        starts_at DESC NULLS LAST,
        created_at DESC`
  );
  return result.rows.map(normalizeEventRecord);
}

export async function fetchPublicEventRecordsFromDatabase() {
  const result = await pool.query(
    `SELECT * FROM events
      WHERE status <> 'draft'
      ORDER BY
        CASE status
          WHEN 'open' THEN 0
          WHEN 'closed' THEN 1
          ELSE 2
        END,
        starts_at DESC NULLS LAST,
        created_at DESC`
  );
  return result.rows.map(normalizeEventRecord);
}

// The bare domain and old QR links have no event slug. They should show the
// open event when one exists, otherwise the most recent public event, so a
// completed event remains viewable while the next one is being prepared.
export async function resolveDefaultPublicEventRecordFromDatabase() {
  const openEventResult = await pool.query(
    `SELECT * FROM events
      WHERE status = 'open'
      ORDER BY starts_at DESC NULLS LAST, created_at DESC
      LIMIT 1`
  );
  if (openEventResult.rows[0]) {
    return normalizeEventRecord(openEventResult.rows[0]);
  }

  const latestPublicEventResult = await pool.query(
    `SELECT * FROM events
      WHERE status IN ('closed', 'archived')
      ORDER BY starts_at DESC NULLS LAST, created_at DESC
      LIMIT 1`
  );
  if (latestPublicEventResult.rows[0]) {
    return normalizeEventRecord(latestPublicEventResult.rows[0]);
  }

  return fetchEventRecordBySlugFromDatabase(PRIMARY_EVENT_SLUG);
}

export async function resolveDefaultOpenEventRecordFromDatabase() {
  const openEventResult = await pool.query(
    `SELECT * FROM events
      WHERE status = 'open'
      ORDER BY starts_at DESC NULLS LAST, created_at DESC
      LIMIT 1`
  );
  return normalizeEventRecord(openEventResult.rows[0]);
}

export async function resolveBookableEventRecordBySlugFromDatabase(eventSlug) {
  const eventRecord = await fetchEventRecordBySlugFromDatabase(eventSlug);
  if (!eventRecord) {
    throw new EventNotFoundError(eventSlug);
  }
  if (eventRecord.status !== 'open') {
    throw new EventNotOpenForBookingError(eventRecord.slug, eventRecord.status);
  }
  return eventRecord;
}

export async function ensureEventSeatCapacityRowExistsForEventRecord(
  databaseClient,
  eventRecord
) {
  const configuredSeatCapacity = Number(
    eventRecord.configuration?.seatCapacity ?? DEFAULT_EVENT_SEAT_CAPACITY
  );

  await databaseClient.query(
    `INSERT INTO event_seat_capacity (event_id, confirmed_count, cap)
     VALUES ($1, 0, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventRecord.id, configuredSeatCapacity]
  );
}

export function buildEventConfigurationFromEventRecord(eventRecord) {
  if (!eventRecord) {
    return null;
  }

  const storedConfiguration = eventRecord.configuration ?? {};
  return {
    ...storedConfiguration,
    slug: eventRecord.slug,
    name: storedConfiguration.name ?? eventRecord.name,
  };
}

export function buildEventSnapshotFromEventRecord(eventRecord) {
  const eventConfiguration = buildEventConfigurationFromEventRecord(eventRecord);
  return JSON.parse(JSON.stringify(eventConfiguration));
}

// This fallback exists for databases that were created before the event
// registry. It never invents a new slug: it only returns the static first-event
// configuration under the same slug that historical rows already use.
export function buildEventSnapshotFromStaticConfiguration(eventSlug = PRIMARY_EVENT_SLUG) {
  const staticConfiguration =
    fetchEventConfigurationBySlug(eventSlug) ?? fetchPrimaryEventConfiguration();

  return staticConfiguration ? JSON.parse(JSON.stringify(staticConfiguration)) : null;
}

export async function createEventRecordInDatabase(eventCreationDetails) {
  const {
    slug,
    name,
    status = 'draft',
    startsAt = null,
    endsAt = null,
    configuration,
  } = eventCreationDetails;

  if (!EVENT_LIFECYCLE_STATUSES.includes(status)) {
    throw new InvalidEventLifecycleStatusError(status);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO events (slug, name, status, starts_at, ends_at, configuration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [slug, name, status, startsAt, endsAt, configuration]
    );

    const createdEventRecord = normalizeEventRecord(insertResult.rows[0]);
    await ensureEventSeatCapacityRowExistsForEventRecord(client, createdEventRecord);

    await client.query('COMMIT');
    return createdEventRecord;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      throw new EventSlugAlreadyExistsError(slug);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateEventConfigurationInDatabase(eventId, eventConfiguration) {
  const eventName = eventConfiguration?.name ?? null;
  const updateResult = await pool.query(
    `UPDATE events
        SET configuration = $2,
            name = COALESCE($3, name),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [eventId, eventConfiguration, eventName]
  );

  return normalizeEventRecord(updateResult.rows[0]);
}

export async function updateEventLifecycleStatusInDatabase(eventId, eventStatus) {
  if (!EVENT_LIFECYCLE_STATUSES.includes(eventStatus)) {
    throw new InvalidEventLifecycleStatusError(eventStatus);
  }

  const updateResult = await pool.query(
    `UPDATE events
        SET status = $2,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [eventId, eventStatus]
  );

  return normalizeEventRecord(updateResult.rows[0]);
}
