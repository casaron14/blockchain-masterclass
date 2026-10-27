import { generateAdminSummaryReport } from '../services/reconciliationService.js';

import {
  fetchAdminBookingList,
  fetchBookingStatusCounts,
  fetchAdminBookingDetail,
  createAdminBookingRecord,
  updateAdminBookingRecord,
  confirmAdminBookingRecord,
  adminBookingCreationSchema,
  adminBookingUpdateSchema,
  InvalidAdminBookingStatusError,
  BookingNotConfirmableError,
} from '../services/adminBookingService.js';

import {
  buildBookingsCsvDocument,
  buildCsvExportFileName,
} from '../services/adminCsvExportService.js';

import {
  buildGoogleSheetBookingSyncFailureMessage,
  buildGoogleSheetBookingSyncMessage,
  GoogleSheetBookingSyncError,
  syncAllBookingsToGoogleSheet,
} from '../services/googleSheetBookingSyncService.js';

import {
  AppsScriptWebhookError,
  APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED_ERROR_CODE,
  APPS_SCRIPT_WEBHOOK_URL_INVALID_ERROR_CODE,
} from '../services/appsScriptWebhookClientService.js';

import { BookingNotFoundError, SoldOutError } from '../services/bookingService.js';

import { sendCsvFileDownloadResponse } from '../utils/csvDownloadResponse.js';

import {
  validationFailedResponse,
  soldOutResponse,
  bookingNotFoundResponse,
  adminBookingStatusInvalidResponse,
} from '../utils/responseHelpers.js';

async function fetchAdminSummaryReport(req, res) {
  try {
    const summaryReport = await generateAdminSummaryReport({});
    return res.status(200).json({ report: summaryReport });
  } catch (error) {
    console.error('Error generating admin summary report', error);
    return res.status(500).json({ message: 'Error generating admin summary report' });
  }
}

async function fetchAdminBookingListEndpoint(req, res) {
  const { status: statusFilter, q: searchQuery } = req.query;

  try {
    const bookingRows = await fetchAdminBookingList({ statusFilter, searchQuery });
    const statusCounts = await fetchBookingStatusCounts();
    return res.status(200).json({ bookings: bookingRows, counts: statusCounts });
  } catch (error) {
    console.error('Error fetching admin booking list', error);
    return res.status(500).json({ message: 'Error fetching bookings' });
  }
}

async function exportAdminBookingListAsCsvEndpoint(req, res) {
  const { status: statusFilter, q: searchQuery } = req.query;

  try {
    const bookingRows = await fetchAdminBookingList({ statusFilter, searchQuery });
    const csvDownloadFileName = buildCsvExportFileName(
      statusFilter ? `bookings-${statusFilter}` : 'bookings'
    );

    return sendCsvFileDownloadResponse(
      res,
      buildBookingsCsvDocument(bookingRows),
      csvDownloadFileName
    );
  } catch (error) {
    console.error('Error exporting admin booking list as CSV', error);
    return res.status(500).json({ message: 'Error exporting bookings' });
  }
}

async function fetchAdminBookingDetailEndpoint(req, res) {
  const bookingId = parseInt(req.params.id, 10);

  try {
    const bookingDetail = await fetchAdminBookingDetail(bookingId);
    return res.status(200).json(bookingDetail);
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    console.error('Error fetching admin booking detail', error);
    return res.status(500).json({ message: 'Error fetching booking' });
  }
}

async function createAdminBookingEndpoint(req, res) {
  // A request that arrives without a parsed JSON body must answer 400, not
  // crash on destructuring undefined.
  const { autoConfirm = false, ...attendeeDetails } = req.body ?? {};

  const { error: validationError, value: validatedAttendeeDetails } =
    adminBookingCreationSchema.validate(attendeeDetails);

  if (validationError) {
    return res
      .status(400)
      .json(validationFailedResponse(validationError));
  }

  try {
    const createdBooking = await createAdminBookingRecord(validatedAttendeeDetails, {
      autoConfirm: Boolean(autoConfirm),
    });
    return res.status(201).json({ booking: createdBooking });
  } catch (error) {
    if (error.code === 'SOLD_OUT') {
      return res.status(400).json(soldOutResponse(0));
    }
    console.error('Error creating admin booking', error);
    return res.status(500).json({ message: 'Error creating booking' });
  }
}

async function updateAdminBookingEndpoint(req, res) {
  const bookingId = parseInt(req.params.id, 10);

  const { error: validationError, value: validatedUpdate } =
    adminBookingUpdateSchema.validate(req.body ?? {});

  if (validationError) {
    return res
      .status(400)
      .json(validationFailedResponse(validationError));
  }

  try {
    const updatedBooking = await updateAdminBookingRecord(bookingId, validatedUpdate);
    return res.status(200).json({ booking: updatedBooking });
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    if (error instanceof SoldOutError) {
      return res.status(400).json(soldOutResponse(0));
    }
    if (error instanceof InvalidAdminBookingStatusError) {
      return res.status(400).json(adminBookingStatusInvalidResponse(error.invalidStatus));
    }
    console.error('Error updating admin booking', error);
    return res.status(500).json({ message: 'Error updating booking' });
  }
}

async function confirmAdminBookingEndpoint(req, res) {
  const bookingId = parseInt(req.params.id, 10);

  try {
    const confirmationResult = await confirmAdminBookingRecord(bookingId);
    return res.status(200).json(confirmationResult);
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json(bookingNotFoundResponse());
    }
    if (error instanceof BookingNotConfirmableError) {
      return res.status(409).json({
        message:
          'A cancelled booking cannot be confirmed. Set the booking status back to pending first.',
        error: error.code,
      });
    }
    if (error instanceof SoldOutError) {
      return res.status(400).json(soldOutResponse(0));
    }
    console.error('Error confirming admin booking', error);
    return res.status(500).json({ message: 'Error confirming booking' });
  }
}

async function syncAdminBookingsToGoogleSheetEndpoint(req, res) {
  try {
    const syncSummary = await syncAllBookingsToGoogleSheet();

    return res.status(200).json({
      ...syncSummary,
      message: buildGoogleSheetBookingSyncMessage(syncSummary),
    });
  } catch (error) {
    if (
      error instanceof AppsScriptWebhookError &&
      (error.errorCode === APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED_ERROR_CODE ||
        error.errorCode === APPS_SCRIPT_WEBHOOK_URL_INVALID_ERROR_CODE)
    ) {
      return res.status(503).json({
        message:
          'Google Sheets sync is not configured. Set APPS_SCRIPT_TICKET_WEBHOOK_URL and APPS_SCRIPT_SHARED_SECRET on the server.',
        error: error.errorCode,
      });
    }

    if (error instanceof GoogleSheetBookingSyncError) {
      console.error('google_sheet_booking_sync_failed', {
        failureReasons: error.syncSummary.failureReasons,
      });

      return res.status(502).json({
        ...error.syncSummary,
        message: buildGoogleSheetBookingSyncFailureMessage(
          error.syncSummary.failureReasons
        ),
        error: error.code,
      });
    }

    console.error('Error syncing admin bookings to Google Sheets', error);
    return res.status(500).json({
      message: 'Error syncing bookings to Google Sheets',
    });
  }
}

export default {
  fetchAdminSummaryReport,
  fetchAdminBookingListEndpoint,
  exportAdminBookingListAsCsvEndpoint,
  fetchAdminBookingDetailEndpoint,
  createAdminBookingEndpoint,
  updateAdminBookingEndpoint,
  confirmAdminBookingEndpoint,
  syncAdminBookingsToGoogleSheetEndpoint,
};
