import {
  InvalidManagedEventInputError,
  createManagedEventRecord,
  fetchAdminEventListWithCapacity,
  updateManagedEventRecord,
} from '../services/eventAdminService.js';

import {
  EventSlugAlreadyExistsError,
  InvalidEventLifecycleStatusError,
} from '../services/eventRegistryService.js';

import { eventNotFoundResponse } from '../utils/responseHelpers.js';

async function fetchAdminEventListEndpoint(req, res) {
  try {
    const eventRecords = await fetchAdminEventListWithCapacity();
    return res.status(200).json({ events: eventRecords });
  } catch (error) {
    console.error('Error fetching admin event list', error);
    return res.status(500).json({ message: 'Error fetching events' });
  }
}

async function createAdminEventEndpoint(req, res) {
  try {
    const createdEventRecord = await createManagedEventRecord(req.body);
    return res.status(201).json({ event: createdEventRecord });
  } catch (error) {
    if (error instanceof InvalidManagedEventInputError) {
      return res
        .status(400)
        .json({ message: 'Validation failed', error: error.detailsMessage });
    }
    if (error instanceof EventSlugAlreadyExistsError) {
      return res.status(409).json({ message: error.message });
    }
    if (error instanceof InvalidEventLifecycleStatusError) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Error creating event', error);
    return res.status(500).json({ message: 'Error creating event' });
  }
}

async function updateAdminEventEndpoint(req, res) {
  const eventId = Number.parseInt(req.params.id, 10);

  try {
    const updatedEventRecord = await updateManagedEventRecord(eventId, req.body);
    if (!updatedEventRecord) {
      return res.status(404).json(eventNotFoundResponse());
    }
    return res.status(200).json({ event: updatedEventRecord });
  } catch (error) {
    if (error instanceof InvalidManagedEventInputError) {
      return res
        .status(400)
        .json({ message: 'Validation failed', error: error.detailsMessage });
    }
    if (error instanceof InvalidEventLifecycleStatusError) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Error updating event', error);
    return res.status(500).json({ message: 'Error updating event' });
  }
}

export default {
  fetchAdminEventListEndpoint,
  createAdminEventEndpoint,
  updateAdminEventEndpoint,
};
