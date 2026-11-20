import paymentRouter from '../../../../backend/routes/paymentRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const paymentApiApplication = createScopedApiApplication('/api/payments', paymentRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
  // Confirming a USDT claim renders a receipt and sends email; a receipt
  // upload can push a multi-megabyte file to storage.
  maxDuration: 60,
};

export default function forwardPaymentApiRequestToExpressRouter(request, response) {
  paymentApiApplication(request, response);
}
