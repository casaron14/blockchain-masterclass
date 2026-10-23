import express from 'express';

import cronController from '../controller/cronController.js';

const router = express.Router();

// Called by Vercel Cron or an external scheduler. Authorization is checked
// inside the controller against CRON_SECRET, and the endpoint refuses to run
// when the secret is missing.
router.get('/tick', cronController.runScheduledJobTickEndpoint);
router.post('/tick', cronController.runScheduledJobTickEndpoint);

export default router;
