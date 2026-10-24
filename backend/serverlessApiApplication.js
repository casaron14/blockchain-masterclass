import './config/environment.js';

import express from 'express';

import handleApplicationError, {
  handleNotFoundRoute,
} from './middleware/errorHandler.js';
import {
  buildCorsPolicy,
  buildSecurityHeaders,
} from './middleware/httpSecurityMiddleware.js';
import { attachRequestLogging } from './middleware/requestLoggingMiddleware.js';

export function configureCommonApiMiddleware(expressApplication) {
  expressApplication.disable('x-powered-by');

  const trustedProxyHopCount = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
  expressApplication.set(
    'trust proxy',
    Number.isNaN(trustedProxyHopCount) ? 0 : trustedProxyHopCount
  );

  expressApplication.use(attachRequestLogging);
  expressApplication.use(buildSecurityHeaders());
  expressApplication.use(buildCorsPolicy());
  expressApplication.use(express.json({ limit: '16kb' }));
}

export function createScopedApiApplication(apiBasePath, apiRouter) {
  const expressApplication = express();

  configureCommonApiMiddleware(expressApplication);
  expressApplication.use(apiBasePath, apiRouter);
  expressApplication.use(handleNotFoundRoute);
  expressApplication.use(handleApplicationError);

  return expressApplication;
}
