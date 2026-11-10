import {
  fetchEffectiveEventConfiguration,
  fetchLiveSeatCapacitySnapshot,
  fetchEventConfigurationOverridesFromDatabase,
  saveEventConfigurationOverrides,
  InvalidEventConfigOverrideError,
  SeatCapacityBelowConfirmedCountError,
} from '../services/eventConfigAdminService.js';

async function fetchAdminEventConfigurationEndpoint(req, res) {
  try {
    const configuration = await fetchEffectiveEventConfiguration();
    const liveSeatCapacity = await fetchLiveSeatCapacitySnapshot();
    const overrideRow = await fetchEventConfigurationOverridesFromDatabase();

    return res.status(200).json({
      configuration,
      liveSeatCapacity,
      updatedAt: overrideRow?.updated_at ?? null,
    });
  } catch (error) {
    console.error('Error fetching admin event configuration', error);
    return res.status(500).json({ message: 'Error fetching event configuration' });
  }
}

async function updateAdminEventConfigurationEndpoint(req, res) {
  try {
    const configurationReport = await saveEventConfigurationOverrides(req.body);
    return res.status(200).json(configurationReport);
  } catch (error) {
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