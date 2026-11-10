import {
  fetchEffectiveEventConfiguration,
  fetchLiveSeatCapacitySnapshot,
  fetchEventConfigurationOverridesFromDatabase,
  saveEventConfigurationOverrides,
  EventConfigurationNotFoundError,
  InvalidEventConfigOverrideError,
  SeatCapacityBelowConfirmedCountError,
} from '../services/eventConfigAdminService.js';

function readRequestedEventSlug(req) {
  return typeof req.query?.event === 'string' && req.query.event.trim()
    ? req.query.event.trim()
    : undefined;
}

async function fetchAdminEventConfigurationEndpoint(req, res) {
  const requestedEventSlug = readRequestedEventSlug(req);

  try {
    const configuration = await fetchEffectiveEventConfiguration(requestedEventSlug);
    if (!configuration) {
      throw new EventConfigurationNotFoundError(requestedEventSlug ?? 'default');
    }
    const liveSeatCapacity = await fetchLiveSeatCapacitySnapshot(requestedEventSlug);
    const overrideRow = await fetchEventConfigurationOverridesFromDatabase(
      requestedEventSlug
    );

    return res.status(200).json({
      configuration,
      liveSeatCapacity,
      updatedAt: overrideRow?.updated_at ?? null,
    });
  } catch (error) {
    if (error instanceof EventConfigurationNotFoundError) {
      return res.status(404).json({ message: 'Event configuration not found' });
    }
    console.error('Error fetching admin event configuration', error);
    return res.status(500).json({ message: 'Error fetching event configuration' });
  }
}

async function updateAdminEventConfigurationEndpoint(req, res) {
  const requestedEventSlug = readRequestedEventSlug(req);

  try {
    const configurationReport = await saveEventConfigurationOverrides(
      req.body,
      requestedEventSlug
    );
    return res.status(200).json(configurationReport);
  } catch (error) {
    if (error instanceof EventConfigurationNotFoundError) {
      return res.status(404).json({ message: 'Event configuration not found' });
    }
    if (error instanceof InvalidEventConfigOverrideError) {
      return res
        .status(400)
        .json({ message: 'Validation failed', error: error.detailsMessage });
    }

    if (error instanceof SeatCapacityBelowConfirmedCountError) {
      return res.status(409).json({
        message: error.message,
        seatsConfirmed: error.confirmedCount,
      });
    }

    console.error('Error updating admin event configuration', error);
    return res.status(500).json({ message: 'Error updating event configuration' });
  }
}

export default {
  fetchAdminEventConfigurationEndpoint,
  updateAdminEventConfigurationEndpoint,
};