import express from 'express';
import adminController from '../controller/adminController.js';
import adminConfigController from '../controller/adminConfigController.js';
import adminPaymentReviewController from '../controller/adminPaymentReviewController.js';
import adminTransactionController from '../controller/adminTransactionController.js';
import offlinePaymentController from '../controller/offlinePaymentController.js';
import referrerController from '../controller/referrerController.js';
import requireAdminAccess from '../middleware/adminAuthMiddleware.js';
import { createGeneralRequestRateLimiter } from '../middleware/rateLimiter.js';
import { validatePositiveIntegerRouteParam } from '../middleware/requestValidators.js';

const router = express.Router();

router.use(createGeneralRequestRateLimiter());
router.use(requireAdminAccess);

router.get('/report', adminController.fetchAdminSummaryReport);

router.get('/configuration', adminConfigController.fetchAdminEventConfigurationEndpoint);

router.put('/configuration', adminConfigController.updateAdminEventConfigurationEndpoint);

router.get('/transactions', adminTransactionController.fetchTransactionTrackingEndpoint);

router.get(
  '/payment-review-flags',
  adminPaymentReviewController.fetchPaymentReviewFlagsEndpoint
);

router.post(
  '/payment-review-flags/:id/resolve',
  validatePositiveIntegerRouteParam('id'),
  adminPaymentReviewController.resolvePaymentReviewFlagEndpoint
);

router.get('/referrals', referrerController.fetchReferralTrackingSummary);

router.get(
  '/referrals/export.csv',
  referrerController.exportReferralSummaryAsCsvEndpoint
);

router.post('/referrals', referrerController.createReferrerInviteRecordEndpoint);

router.get(
  '/referrals/:referrerCode/clients',
  referrerController.fetchReferredClientsEndpoint
);

router.get(
  '/referrals/:referrerCode/export.csv',
  referrerController.exportReferredClientsAsCsvEndpoint
);

router.get('/bookings', adminController.fetchAdminBookingListEndpoint);

// Explicitly a POST: the sync writes to the Sheet and must never be triggered
// by a prefetched link or a browser reload.
router.post(
  '/google-sheet/sync-bookings',
  adminController.syncAdminBookingsToGoogleSheetEndpoint
);

// Declared before /bookings/:id so the literal "export.csv" segment is not
// parsed as a numeric booking id.
router.get(
  '/bookings/export.csv',
  adminController.exportAdminBookingListAsCsvEndpoint
);

router.post('/bookings', adminController.createAdminBookingEndpoint);

router.get(
  '/bookings/:id',
  validatePositiveIntegerRouteParam('id'),
  adminController.fetchAdminBookingDetailEndpoint
);

router.put(
  '/bookings/:id',
  validatePositiveIntegerRouteParam('id'),
  adminController.updateAdminBookingEndpoint
);

router.post(
  '/bookings/:id/confirm',
  validatePositiveIntegerRouteParam('id'),
  adminController.confirmAdminBookingEndpoint
);

router.get(
  '/bookings/:id/offline-receipt',
  validatePositiveIntegerRouteParam('id'),
  offlinePaymentController.downloadOfflinePaymentReceiptForAdminEndpoint
);

export default router;