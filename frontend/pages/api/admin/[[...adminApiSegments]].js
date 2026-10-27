import adminRouter from '../../../../backend/routes/adminRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const adminApiApplication = createScopedApiApplication('/api/admin', adminRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
  // Confirming a booking renders the ticket PNG and waits for the email
  // provider, so the default Hobby timeout is too short.
  maxDuration: 60,
};

export default function forwardAdminApiRequestToExpressRouter(request, response) {
  adminApiApplication(request, response);
}
