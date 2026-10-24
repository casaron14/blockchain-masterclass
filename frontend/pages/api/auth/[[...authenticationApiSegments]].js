import authRouter from '../../../../backend/routes/authRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const authenticationApiApplication = createScopedApiApplication('/api/auth', authRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function forwardAuthenticationApiRequestToExpressRouter(request, response) {
  authenticationApiApplication(request, response);
}
