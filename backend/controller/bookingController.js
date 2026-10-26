import Joi from 'joi';

import {
  createBookingRecordWithActiveSeatHold,
  fetchBookingRecordById,
  fetchBookingRecordByReferenceCode,
  fetchEventAvailabilitySnapshot,
  reactivateExpiredBookingSeatHold,
  BookingNotFoundError,
  BookingNotExpiredError,
} from '../services/bookingService.js';

import {
  performBookingReferenceLookup,
  performBookingLookupBySearchValue,
  AmbiguousBookingLookupError,
} from '../services/bookingLookupService.js';

import { InvalidBookingSearchValueError } from '../services/bookingSearchIdentifierService.js';

import {
  ambiguousBookingLookupResponse,
  bookingNotFoundResponse,
  invalidBookingSearchValueResponse,
  missingRequiredFieldResponse,
  soldOutResponse,
  validationFailedResponse,
} from '../utils/responseHelpers.js';

const bookingCreationSchema = Joi.object({
  full_name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().required(),
  phone_number: Joi.string()
    .trim()
    .pattern(/^\+?[0-9]{9,15}$/)
    .required(),
  utm_source: Joi.string()
    .trim()
    .allow('')
    .pattern(/^[a-zA-Z0-9_.-]{2,100}$/)
    .optional(),
});

async function createBookingRecord(req, res) {
  const { error: validationError, value: validatedAttendeeDetails } =
    bookingCreationSchema.validate(req.body);

  if (validationError) {
    return res
      .status(400)
      .json(validationFailedResponse(validationError));
  }

  try {
    const bookingRecord = await createBookingRecordWithActiveSeatHold(validatedAttendeeDetails);
    return res.status(201).json({ booking: bookingRecord });
  } catch (error) {
    if (error.code === 'SOLD_OUT') {
      return res.status(400).json(soldOutResponse(0));
    }
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ message: 'A booking for this phone number already exists' });
    }
    console.error('Error creating booking', error);
    return res.status(500).json({ message: 'Server error while creating booking' });
  }
}

async function fetchEventAvailability(req, res) {
  try {
    const availabilitySnapshot = await fetchEventAvailabilitySnapshot();
    return res.status(200).json(availabilitySnapshot);
  } catch (error) {
    console.error('Error fetching event availability', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

// The numeric booking id is sequential, so it is not proof of ownership. Only
// the reference code is. Status polling therefore exposes the fields the
// payment page needs and never the attendee's name, email or phone number.
function buildPublicBookingStatusProjection(bookingRecord) {
  return {
    id: bookingRecord.id,
    ref: bookingRecord.ref,
    status: bookingRecord.status,
    expires_at: bookingRecord.expires_at,
  };
}

async function getBookingRecordById(req, res) {
  const bookingId = parseInt(req.params.id, 10);

  try {
    const bookingRecord = await fetchBookingRecordById(bookingId);
    if (!bookingRecord) {
      throw new BookingNotFoundError(bookingId);
    }
    return res.status(200).json({ booking: buildPublicBookingStatusProjection(bookingRecord) });
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    console.error('Error fetching booking by id', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function getBookingRecordByReferenceCode(req, res) {
  const bookingReferenceCode = req.params.ref;

  try {
    const bookingRecord = await fetchBookingRecordByReferenceCode(bookingReferenceCode);
    if (!bookingRecord) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    return res.status(200).json({ booking: bookingRecord });
  } catch (error) {
    console.error('Error fetching booking by reference', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function getBookingDetailsForReferenceLookup(req, res) {
  const bookingReferenceCode = (req.params.ref || '').trim().toUpperCase();

  if (!bookingReferenceCode) {
    return res.status(400).json(missingRequiredFieldResponse('Booking reference'));
  }

  try {
    const lookupResult = await performBookingReferenceLookup(bookingReferenceCode);
    if (!lookupResult) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    return res.status(200).json(lookupResult);
  } catch (error) {
    console.error('Error performing booking reference lookup', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function getBookingDetailsForSearchLookup(req, res) {
  const bookingSearchValue = typeof req.query?.q === 'string' ? req.query.q : '';

  if (!bookingSearchValue.trim()) {
    return res.status(400).json(missingRequiredFieldResponse('Search value'));
  }

  try {
    const lookupResult = await performBookingLookupBySearchValue(bookingSearchValue, {
      allowAttendeeNameSearch: false,
    });
    if (!lookupResult) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    return res.status(200).json(lookupResult);
  } catch (error) {
    if (error instanceof InvalidBookingSearchValueError) {
      return res.status(400).json(invalidBookingSearchValueResponse(error.message));
    }
    if (error instanceof AmbiguousBookingLookupError) {
      return res
        .status(409)
        .json(ambiguousBookingLookupResponse(error.matchingBookingCount));
    }
    console.error('Error performing booking search lookup', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function reactivateBookingHold(req, res) {
  const bookingId = parseInt(req.params.id, 10);
  const providedBookingReferenceCode = String(req.body?.booking_ref || '')
    .trim()
    .toUpperCase();

  if (!providedBookingReferenceCode) {
    return res.status(400).json(missingRequiredFieldResponse('booking_ref'));
  }

  try {
    // Reactivation mutates seat state, so knowing the sequential id is not
    // enough: the caller must also present the booking's secret reference code.
    const existingBookingRecord = await fetchBookingRecordById(bookingId);
    if (
      !existingBookingRecord ||
      String(existingBookingRecord.ref).toUpperCase() !== providedBookingReferenceCode
    ) {
      throw new BookingNotFoundError(bookingId);
    }

    const reactivatedBooking = await reactivateExpiredBookingSeatHold(bookingId);
    if (!reactivatedBooking) {
      throw new BookingNotFoundError(bookingId);
    }
    return res.status(200).json({ booking: reactivatedBooking });
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    if (error instanceof BookingNotExpiredError) {
      return res.status(409).json({ message: error.message });
    }
    if (error.code === 'SOLD_OUT') {
      return res.status(400).json(soldOutResponse(0));
    }
    console.error('Error reactivating booking hold', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

export default {
  createBookingRecord,
  fetchEventAvailability,
  getBookingRecordById,
  getBookingRecordByReferenceCode,
  getBookingDetailsForReferenceLookup,
  getBookingDetailsForSearchLookup,
  reactivateBookingHold,
};