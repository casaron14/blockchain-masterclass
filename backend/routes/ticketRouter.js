import express from "express";
import ticketController from "../controller/ticketController.js";
import requireAdminAccess from "../middleware/adminAuthMiddleware.js";
import { createGeneralRequestRateLimiter } from "../middleware/rateLimiter.js";
import { validatePositiveIntegerRouteParam } from "../middleware/requestValidators.js";

const router = express.Router();

// Re-sending someone's ticket is an operator action, not a public one: without
// this guard anybody who guessed a booking id could trigger mail.
router.post(
  "/redeliver/:bookingId",
  createGeneralRequestRateLimiter(),
  requireAdminAccess,
  validatePositiveIntegerRouteParam("bookingId"),
  ticketController.redeliverTicketEmailEndpoint
);

router.get(
  "/:bookingRef/receipt",
  createGeneralRequestRateLimiter(),
  ticketController.downloadPaymentReceiptEndpoint
);

router.get(
  "/:bookingRef/download",
  createGeneralRequestRateLimiter(),
  ticketController.downloadTicketPdfEndpoint
);

export default router;
