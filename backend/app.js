import './config/environment.js';

import express from 'express';

import apiRouter from './routes/index.js';
import azamPayWebhookRouter from './routes/azamPayWebhookRouter.js';
import handleApplicationError, {
  handleNotFoundRoute,
} from './middleware/errorHandler.js';
import { AZAMPESA_PAYMENTS_ENABLED } from './services/eventConfigService.js';
import { configureCommonApiMiddleware } from './serverlessApiApplication.js';
import { respondToDatabaseHealthCheck } from './controller/healthController.js';

// The HTTP application is built here, without listening on a port and without
// starting background jobs, so the same app can be served by a long-lived Node
// process (server.js) or by the single Next.js serverless function
// (frontend/pages/api/[...all].js on Vercel).
export function createApplication() {
  const app = express();

  configureCommonApiMiddleware(app);

  app.use('/api', apiRouter);

  // AzamPesa is retired. The webhook trusts the payload it receives, so it is
  // not reachable at all while the method is disabled (see shared/eventConfig.js).
  if (AZAMPESA_PAYMENTS_ENABLED) {
    app.use('/webhook/azampay', azamPayWebhookRouter);
  }

  app.get('/', respondToDatabaseHealthCheck);
  app.get('/api/health', respondToDatabaseHealthCheck);

  app.use(handleNotFoundRoute);
  app.use(handleApplicationError);

  return app;
}

const app = createApplication();

export default app;
