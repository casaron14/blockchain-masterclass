import adminRouter from '../../../../backend/routes/adminRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const adminApiApplication = createScopedApiApplication('/api/admin', adminRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function forwardAdminApiRequestToExpressRouter(request, response) {
  adminApiApplication(request, response);
}
