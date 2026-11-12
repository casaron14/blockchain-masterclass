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

// Webhook providers sign the exact bytes they sent. Keeping the parsed body
// only would make the signature unverifiable, because re-serialising the same
// JSON can change key order and whitespace.
function preserveRawRequestBodyForWebhookSignatures(req, res, bodyBuffer) {
  req.rawBody = bodyBuffer;
}

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
  expressApplication.use(
    express.json({
      // Address Activity payloads can carry many transfers at once, so the
      // webhook body limit is larger than a booking form needs.
      limit: '256kb',
      verify: preserveRawRequestBodyForWebhookSignatures,
    })
  );
}

export function createScopedApiApplication(apiBasePath, apiRouter) {
  const expressApplication = express();

  configureCommonApiMiddleware(expressApplication);
  expressApplication.use(apiBasePath, apiRouter);
  expressApplication.use(handleNotFoundRoute);
  expressApplication.use(handleApplicationError);

  return expressApplication;
}
