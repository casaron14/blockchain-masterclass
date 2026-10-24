import bookingRouter from '../../../../backend/routes/bookingRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const bookingApiApplication = createScopedApiApplication('/api/bookings', bookingRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function forwardBookingApiRequestToExpressRouter(request, response) {
  bookingApiApplication(request, response);
}
