import express from 'express';

import bookingRouter from './bookingRouter.js';
import paymentRouter from './paymentRouter.js';
import authRouter from './authRouter.js';
import eventRouter from './eventRouter.js';
import ticketRouter from './ticketRouter.js';
import adminRouter from './adminRouter.js';
import referrerRouter from './referrerRouter.js';
import cronRouter from './cronRouter.js';

const apiRouter = express.Router();

apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/events', eventRouter);
apiRouter.use('/tickets', ticketRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/referrals', referrerRouter);
apiRouter.use('/cron', cronRouter);

export default apiRouter;
