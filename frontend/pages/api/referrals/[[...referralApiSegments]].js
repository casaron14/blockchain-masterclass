import referrerRouter from '../../../../backend/routes/referrerRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const referralApiApplication = createScopedApiApplication('/api/referrals', referrerRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function forwardReferralApiRequestToExpressRouter(request, response) {
  referralApiApplication(request, response);
}
