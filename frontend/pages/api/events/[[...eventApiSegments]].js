import eventRouter from '../../../../backend/routes/eventRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const eventApiApplication = createScopedApiApplication('/api/events', eventRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function forwardEventApiRequestToExpressRouter(request, response) {
  eventApiApplication(request, response);
}
