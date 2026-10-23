import express from "express";
import azamPayWebhookController from "../controller/azamPayWebhookController.js";
import { createWebhookInboundRateLimiter } from "../middleware/rateLimiter.js";
import { requireAzamPayWebhookSourceIpAllowlist } from "../middleware/azamPayWebhookGuard.js";

const router = express.Router();

router.post(
  "/",
  createWebhookInboundRateLimiter(),
  requireAzamPayWebhookSourceIpAllowlist,
  azamPayWebhookController.receiveAzamPayWebhook
);

export default router;