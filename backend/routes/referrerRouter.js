import express from "express";
import referrerController from "../controller/referrerController.js";
import { createGeneralRequestRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// self-service invite link registration (public)
router.post(
  "/register",
  createGeneralRequestRateLimiter(),
  referrerController.registerReferrerInviteLink
);

export default router;