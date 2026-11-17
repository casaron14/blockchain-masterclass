import express from "express";
import bookingController from "../controller/bookingController.js";
import { verifyTurnstileChallengeToken } from "../middleware/turnstileVerifier.js";
import {
  createStrictBookingRateLimiter,
  createAttendeeBookingLookupRateLimiter,
  createGeneralRequestRateLimiter,
} from "../middleware/rateLimiter.js";
import { validatePositiveIntegerRouteParam } from "../middleware/requestValidators.js";
import { preventSensitiveResponseCaching } from "../middleware/httpSecurityMiddleware.js";

const router = express.Router();

router.use(preventSensitiveResponseCaching);

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

// A lookup by sequential booking id was removed: it handed the booking ref
// (the ownership credential) to anyone who guessed the id. The payment page
// now receives the safe booking projection from the payment's public token.

export default router;