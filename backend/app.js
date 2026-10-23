import './config/environment.js';

import express from 'express';

import pool from './config/db.js';

import apiRouter from './routes/index.js';
import azamPayWebhookRouter from './routes/azamPayWebhookRouter.js';
import handleApplicationError, { handleNotFoundRoute } from './middleware/errorHandler.js';
import { buildSecurityHeaders, buildCorsPolicy } from './middleware/httpSecurityMiddleware.js';
import { attachRequestLogging } from './middleware/requestLoggingMiddleware.js';
import { AZAMPESA_PAYMENTS_ENABLED } from './services/eventConfigService.js';
import { logError } from './utils/applicationLogger.js';

// The HTTP application is built here, without listening on a port and without
// starting background jobs, so the same app can be served by a long-lived Node
// process (server.js) or by a serverless function (api/[...all].js on Vercel).
export function createApplication() {
  const app = express();

  app.disable('x-powered-by');

  const trustProxyHopCount = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
  app.set('trust proxy', Number.isNaN(trustProxyHopCount) ? 0 : trustProxyHopCount);

  app.use(attachRequestLogging);
  app.use(buildSecurityHeaders());
  app.use(buildCorsPolicy());
  app.use(express.json({ limit: '16kb' }));

  app.use('/api', apiRouter);

  // AzamPesa is retired. The webhook trusts the payload it receives, so it is
  // not reachable at all while the method is disabled (see shared/eventConfig.js).
  if (AZAMPESA_PAYMENTS_ENABLED) {
    app.use('/webhook/azampay', azamPayWebhookRouter);
  }

  async function respondToHealthCheck(req, res) {
    try {
      await pool.query('SELECT 1');
      return res.json({
        status: 'ok',
        database: 'connected',
        requestId: req.requestId,
      });
    } catch (error) {
      logError('health_check_database_probe_failed', {
        requestId: req.requestId,
        errorMessage: error.message,
      });
      return res.status(503).json({
        status: 'degraded',
        database: 'unavailable',
        requestId: req.requestId,
      });
    }
  }

  app.get('/', respondToHealthCheck);
  app.get('/api/health', respondToHealthCheck);

  app.use(handleNotFoundRoute);
  app.use(handleApplicationError);

  return app;
}

const app = createApplication();

export default app;
