import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';

import {
  confirmBookingSeatWithinCapacity,
  createBookingRecordWithActiveSeatHold,
  fetchBookingRecordById,
  fetchEventAvailabilitySnapshot,
} from '../services/bookingService.js';

import {
  createEventRecordInDatabase,
  fetchEventRecordBySlugFromDatabase,
  resolveBookableEventRecordBySlugFromDatabase,
  updateEventConfigurationInDatabase,
  updateEventLifecycleStatusInDatabase,
} from '../services/eventRegistryService.js';

import { fetchPrimaryEventConfiguration } from '../services/eventConfigService.js';

const ISOLATED_TEST_EVENT_SLUG = 'multi-event-isolation-test';

async function removeIsolatedTestEventFromDatabase() {
  const eventRecord = await fetchEventRecordBySlugFromDatabase(
    ISOLATED_TEST_EVENT_SLUG
  );
  if (!eventRecord) {
    return;
  }

  await pool.query('DELETE FROM bookings WHERE event_id = $1', [eventRecord.id]);
  await pool.query('DELETE FROM events WHERE id = $1', [eventRecord.id]);
}

function buildIsolatedTestEventConfiguration(eventDateLabel) {
  const configuration = JSON.parse(JSON.stringify(fetchPrimaryEventConfiguration()));
  return {
    ...configuration,
    slug: ISOLATED_TEST_EVENT_SLUG,
    name: 'Isolated Multi Event Test',
    event: {
      ...configuration.event,
      date: eventDateLabel,
    },
    seatCapacity: 2,
  };
}

beforeEach(removeIsolatedTestEventFromDatabase);
afterEach(removeIsolatedTestEventFromDatabase);

test('bookings, capacity and snapshots stay scoped to their own event', async () => {
  const firstEventAvailabilityBefore = await fetchEventAvailabilitySnapshot(
    'blockchain-masterclass'
  );

  const isolatedEventRecord = await createEventRecordInDatabase({
    slug: ISOLATED_TEST_EVENT_SLUG,
    name: 'Isolated Multi Event Test',
    status: 'open',
    startsAt: new Date('2027-05-01T00:00:00Z'),
    endsAt: new Date('2027-05-02T00:00:00Z'),
    configuration: buildIsolatedTestEventConfiguration('1st May 2027'),
  });

  const bookingRecord = await createBookingRecordWithActiveSeatHold(
    {
      full_name: 'Snapshot Attendee',
      email: 'snapshot-attendee@example.com',
      phone_number: '+255712000111',
    },
    isolatedEventRecord
  );

  assert.equal(Number(bookingRecord.event_id), isolatedEventRecord.id);
  assert.equal(bookingRecord.event_snapshot.slug, ISOLATED_TEST_EVENT_SLUG);
  assert.equal(bookingRecord.event_snapshot.event.date, '1st May 2027');

  await updateEventConfigurationInDatabase(
    isolatedEventRecord.id,
    buildIsolatedTestEventConfiguration('2nd May 2027')
  );

  const storedBookingRecord = await fetchBookingRecordById(bookingRecord.id);
  assert.equal(
    storedBookingRecord.event_snapshot.event.date,
    '1st May 2027',
    'editing an event must not rewrite the snapshot of a sold booking'
  );

  await confirmBookingSeatWithinCapacity(bookingRecord.id);

  const isolatedEventAvailability = await fetchEventAvailabilitySnapshot(
    ISOLATED_TEST_EVENT_SLUG
  );
  assert.equal(isolatedEventAvailability.confirmedCount, 1);
  assert.equal(isolatedEventAvailability.seatCapacity, 2);

  const firstEventAvailabilityAfter = await fetchEventAvailabilitySnapshot(
    'blockchain-masterclass'
  );
  assert.equal(
    firstEventAvailabilityAfter.confirmedCount,
    firstEventAvailabilityBefore.confirmedCount,
    'confirming a seat in one event must not change another event'
  );
  assert.equal(
    firstEventAvailabilityAfter.activeSeatHolds,
    firstEventAvailabilityBefore.activeSeatHolds
  );
});

test('a closed event refuses new bookings through the bookable resolver', async () => {
  const isolatedEventRecord = await createEventRecordInDatabase({
    slug: ISOLATED_TEST_EVENT_SLUG,
    name: 'Isolated Multi Event Test',
    status: 'open',
    startsAt: new Date('2027-05-01T00:00:00Z'),
    configuration: buildIsolatedTestEventConfiguration('1st May 2027'),
  });

  await updateEventLifecycleStatusInDatabase(isolatedEventRecord.id, 'closed');

  await assert.rejects(
    () => resolveBookableEventRecordBySlugFromDatabase(ISOLATED_TEST_EVENT_SLUG),
    (error) =>
      error.code === 'EVENT_NOT_OPEN_FOR_BOOKING' &&
      error.eventStatus === 'closed'
  );
});
