import { fetchEffectiveEventConfiguration } from '../services/eventConfigAdminService.js';

import {
  fetchEventRecordBySlugFromDatabase,
  fetchPublicEventRecordsFromDatabase,
  resolveDefaultPublicEventRecordFromDatabase,
} from '../services/eventRegistryService.js';

import { eventNotFoundResponse } from '../utils/responseHelpers.js';

async function getEventConfigurationBySlug(req, res) {
  const eventSlug = req.params.slug;

  const [eventRecord, effectiveEventConfiguration] = await Promise.all([
    fetchEventRecordBySlugFromDatabase(eventSlug),
    fetchEffectiveEventConfiguration(eventSlug),
  ]);
  if (!effectiveEventConfiguration) {
    return res.status(404).json(eventNotFoundResponse());
  }

  return res.status(200).json({
    ...effectiveEventConfiguration,
    lifecycleStatus: eventRecord?.status ?? 'open',
  });
}

async function listPublicEvents(req, res) {
  const [eventRecords, defaultEventRecord] = await Promise.all([
    fetchPublicEventRecordsFromDatabase(),
    resolveDefaultPublicEventRecordFromDatabase(),
  ]);

  return res.status(200).json({
    defaultEventSlug: defaultEventRecord?.slug ?? null,
    events: eventRecords.map((eventRecord) => ({
      slug: eventRecord.slug,
      name: eventRecord.name,
      status: eventRecord.status,
      startsAt: eventRecord.starts_at,
      endsAt: eventRecord.ends_at,
      configuration: eventRecord.configuration,
    })),
  });
}

export default {
  getEventConfigurationBySlug,
  listPublicEvents,
};
