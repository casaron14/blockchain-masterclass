import { randomUUID } from 'node:crypto';

import { logInfo } from '../utils/applicationLogger.js';

export const REQUEST_ID_HEADER_NAME = 'x-request-id';

// One line per request, emitted after the response finishes. It carries a
// request id that is also returned to the client so a support ticket can be
// tied to the exact log line.
export function attachRequestLogging(req, res, next) {
  const incomingRequestId = req.headers[REQUEST_ID_HEADER_NAME];
  const requestId =
    typeof incomingRequestId === 'string' && incomingRequestId.length <= 100
      ? incomingRequestId
      : randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER_NAME, requestId);

  const requestStartedAtMs = Date.now();

  res.on('finish', () => {
    logInfo('http_request_completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - requestStartedAtMs,
      ipAddress: req.ip,
    });
  });

  next();
}
