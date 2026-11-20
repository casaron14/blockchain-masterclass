import { fetchPaymentRecordByPublicToken } from '../services/paymentService.js';
import {
  extendBookingSeatHoldForOfflinePaymentReview,
  fetchBookingRecordById,
} from '../services/bookingService.js';

import {
  InvalidOfflinePaymentReceiptFileError,
  OfflinePaymentReceiptFileMissingError,
  OfflinePaymentReceiptNotFoundError,
  OfflinePaymentReceiptPaymentAlreadyConfirmedError,
  OfflinePaymentReceiptPaymentMismatchError,
  fetchOfflinePaymentReceiptForAdminDownload,
  fetchOfflinePaymentReceiptByBookingId,
  rejectOfflinePaymentReceiptForFailedPayment,
  storeOfflinePaymentReceiptForPayment,
} from '../services/offlinePaymentReceiptService.js';

import { fetchPaymentRecordByBookingId, updatePaymentRecordStatus } from '../services/paymentService.js';

import {
  bookingNotFoundResponse,
  missingRequiredFieldResponse,
  paymentNotFoundResponse,
} from '../utils/responseHelpers.js';

function buildSafeReceiptDownloadFileName(receiptRecord) {
  const normalizedFileName = String(receiptRecord.originalFileName || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\r\n"\\]/g, '')
    .trim();

  return normalizedFileName || `lipanamba-receipt-${receiptRecord.id}`;
}

async function uploadLipaNambaPaymentReceiptEndpoint(req, res) {
  const paymentPublicToken = String(req.params.paymentPublicToken || '');

  try {
    const paymentRecord = await fetchPaymentRecordByPublicToken(paymentPublicToken);
    if (!paymentRecord) {
      return res.status(404).json(paymentNotFoundResponse());
    }

    const bookingRecord = await fetchBookingRecordById(paymentRecord.booking_id);
    if (!bookingRecord) {
      return res.status(404).json(bookingNotFoundResponse());
    }

    if (bookingRecord.status === 'cancelled') {
      return res.status(409).json({
        message: 'This booking has been cancelled and cannot receive a payment receipt',
        error: 'OFFLINE_PAYMENT_RECEIPT_BOOKING_CANCELLED',
      });
    }

    const submittedBookingReferenceCode = String(
      req.body?.booking_ref || ''
    )
      .trim()
      .toUpperCase();
    if (!submittedBookingReferenceCode) {
      return res.status(400).json(missingRequiredFieldResponse('booking_ref'));
    }
    if (submittedBookingReferenceCode !== String(bookingRecord.ref).toUpperCase()) {
      return res.status(403).json({
        message: 'The booking reference does not match this payment',
        error: 'OFFLINE_PAYMENT_RECEIPT_BOOKING_REFERENCE_MISMATCH',
      });
    }

    if (!req.file) {
      return res.status(400).json(missingRequiredFieldResponse('receipt'));
    }

    const offlineReceiptRecord = await storeOfflinePaymentReceiptForPayment({
      paymentRecord,
      bookingRecord,
      receiptFileBuffer: req.file.buffer,
      originalFileName: req.file.originalname,
      declaredMimeType: req.file.mimetype,
    });

    let isSeatHoldActive = false;
    try {
      isSeatHoldActive = await extendBookingSeatHoldForOfflinePaymentReview(
        bookingRecord.id
      );
    } catch (error) {
      console.error('Error extending seat hold for offline payment review', error);
    }

    const refreshedBookingRecord = await fetchBookingRecordById(bookingRecord.id);

    return res.status(201).json({
      message: 'Receipt uploaded. An admin will review it before confirming your payment.',
      offlineReceipt: offlineReceiptRecord,
      isSeatHoldActive,
      bookingExpiresAt: refreshedBookingRecord?.expires_at ?? null,
    });
  } catch (error) {
    if (error instanceof OfflinePaymentReceiptPaymentMismatchError) {
      return res.status(400).json({
        message: 'Receipts can only be uploaded for Lipa Namba payments',
        error: error.code,
      });
    }

    if (error instanceof OfflinePaymentReceiptPaymentAlreadyConfirmedError) {
      return res.status(409).json({
        message: 'This payment has already been confirmed',
        error: error.code,
      });
    }

    if (error instanceof InvalidOfflinePaymentReceiptFileError) {
      return res.status(400).json({
        message: error.message,
        error: error.code,
      });
    }

    console.error('Error uploading Lipa Namba payment receipt', error);
    return res.status(500).json({ message: 'Error uploading payment receipt' });
  }
}

async function rejectOfflinePaymentReceiptForAdminEndpoint(req, res) {
  const bookingId = parseInt(req.params.id, 10);
  const reviewerNote =
    typeof req.body?.reviewer_note === 'string'
      ? req.body.reviewer_note.trim().slice(0, 1000)
      : '';

  try {
    const bookingRecord = await fetchBookingRecordById(bookingId);
    if (!bookingRecord) {
      return res.status(404).json(bookingNotFoundResponse());
    }

    if (bookingRecord.status === 'confirmed') {
      return res.status(409).json({
        message: 'This booking is already confirmed; cancel it before rejecting the receipt',
      });
    }

    const receiptRecord = await fetchOfflinePaymentReceiptByBookingId(bookingId);
    if (!receiptRecord) {
      return res.status(404).json({
        message: 'No receipt has been uploaded for this booking',
      });
    }

    const paymentRecord = await fetchPaymentRecordByBookingId(bookingId);
    if (!paymentRecord) {
      return res.status(404).json(paymentNotFoundResponse());
    }

    if (paymentRecord.status === 'confirmed') {
      return res.status(409).json({
        message: 'This payment is already confirmed and its receipt cannot be rejected',
      });
    }

    const rejectedReceiptRecord = await rejectOfflinePaymentReceiptForFailedPayment(
      paymentRecord.id,
      reviewerNote || null
    );
    await updatePaymentRecordStatus(paymentRecord.id, 'failed');

    return res.status(200).json({ offlineReceipt: rejectedReceiptRecord });
  } catch (error) {
    console.error('Error rejecting Lipa Namba payment receipt', error);
    return res.status(500).json({ message: 'Error rejecting payment receipt' });
  }
}

async function downloadOfflinePaymentReceiptForAdminEndpoint(req, res) {
  const bookingId = parseInt(req.params.id, 10);

  try {
    const { receiptRecord, fileBuffer } =
      await fetchOfflinePaymentReceiptForAdminDownload(bookingId);

    res.set({
      'Content-Type': receiptRecord.mimeType,
      'Content-Disposition': `inline; filename="${buildSafeReceiptDownloadFileName(receiptRecord)}"`,
      'Cache-Control': 'private, no-store',
    });

    return res.send(fileBuffer);
  } catch (error) {
    if (error instanceof OfflinePaymentReceiptNotFoundError) {
      return res.status(404).json({ message: 'No receipt has been uploaded for this booking' });
    }

    if (error instanceof OfflinePaymentReceiptFileMissingError) {
      console.error('Stored Lipa Namba receipt file is missing', error.message);
      return res.status(404).json({ message: 'The uploaded receipt file is no longer available' });
    }

    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'The uploaded receipt file is no longer available' });
    }

    console.error('Error downloading Lipa Namba payment receipt', error);
    return res.status(500).json({ message: 'Error downloading payment receipt' });
  }
}

export default {
  uploadLipaNambaPaymentReceiptEndpoint,
  rejectOfflinePaymentReceiptForAdminEndpoint,
  downloadOfflinePaymentReceiptForAdminEndpoint,
};
