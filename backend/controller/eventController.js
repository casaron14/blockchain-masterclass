import { fetchEffectiveEventConfiguration } from '../services/eventConfigAdminService.js';
import { eventNotFoundResponse } from '../utils/responseHelpers.js';

async function getEventConfigurationBySlug(req, res) {
  const eventSlug = req.params.slug;

  const effectiveEventConfiguration = await fetchEffectiveEventConfiguration(eventSlug);
  if (!effectiveEventConfiguration) {
    return res.status(404).json(eventNotFoundResponse());
  }

  return res.status(200).json(effectiveEventConfiguration);
}

export default {
  getEventConfigurationBySlug,
};