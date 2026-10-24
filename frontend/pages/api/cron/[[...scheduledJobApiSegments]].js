import cronRouter from '../../../../backend/routes/cronRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const scheduledJobApiApplication = createScopedApiApplication('/api/cron', cronRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
  maxDuration: 60,
};

export default function forwardScheduledJobApiRequestToExpressRouter(request, response) {
  scheduledJobApiApplication(request, response);
}
