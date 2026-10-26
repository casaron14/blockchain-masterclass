import express from "express";
import bookingController from "../controller/bookingController.js";
import { verifyTurnstileChallengeToken } from "../middleware/turnstileVerifier.js";
import {
  createStrictBookingRateLimiter,
  createAttendeeBookingLookupRateLimiter,
  createGeneralRequestRateLimiter,
} from "../middleware/rateLimiter.js";
import { validatePositiveIntegerRouteParam } from "../middleware/requestValidators.js";

const router = express.Router();

router.post(
  "/",
  createStrictBookingRateLimiter(),
  verifyTurnstileChallengeToken,
  bookingController.createBookingRecord
);

router.get(
  "/availability",
  createGeneralRequestRateLimiter(),
  bookingController.fetchEventAvailability
);

router.post(
  "/:id/reactivate",
  createStrictBookingRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  bookingController.reactivateBookingHold
);

router.get(
  "/lookup",
  createAttendeeBookingLookupRateLimiter(),
  bookingController.getBookingDetailsForSearchLookup
);

router.get(
  "/lookup/:ref",
  createGeneralRequestRateLimiter(),
  bookingController.getBookingDetailsForReferenceLookup
);

router.get(
  "/ref/:ref",
  createGeneralRequestRateLimiter(),
  bookingController.getBookingRecordByReferenceCode
);

router.get(
  "/:id",
  createGeneralRequestRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  bookingController.getBookingRecordById
);

export default router;