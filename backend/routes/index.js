import express from 'express';

import bookingRouter from './bookingRouter.js';
import paymentRouter from './paymentRouter.js';
import authRouter from './authRouter.js';
import eventRouter from './eventRouter.js';
import ticketRouter from './ticketRouter.js';
import adminRouter from './adminRouter.js';
import cronRouter from './cronRouter.js';
import alchemyWebhookRouter from './alchemyWebhookRouter.js';

const apiRouter = express.Router();

apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/events', eventRouter);
apiRouter.use('/tickets', ticketRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/cron', cronRouter);

// Deposit detection fast path. It lives under /api so the Vercel catch-all
// (frontend/pages/api/[...all].js) serves it exactly like the other endpoints;
// the polling listener keeps running as the backfill.
apiRouter.use('/webhook/alchemy', alchemyWebhookRouter);

export default apiRouter;
