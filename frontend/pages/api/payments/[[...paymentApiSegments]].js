import paymentRouter from '../../../../backend/routes/paymentRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const paymentApiApplication = createScopedApiApplication('/api/payments', paymentRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function forwardPaymentApiRequestToExpressRouter(request, response) {
  paymentApiApplication(request, response);
}
