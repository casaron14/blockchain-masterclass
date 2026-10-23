import express from 'express';
import eventController from '../controller/eventController.js';
import { createGeneralRequestRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get(
  '/:slug',
  createGeneralRequestRateLimiter(),
  eventController.getEventConfigurationBySlug
);

export default router;