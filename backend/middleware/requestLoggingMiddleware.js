import { randomUUID } from 'node:crypto';

import { logInfo } from '../utils/applicationLogger.js';

export const REQUEST_ID_HEADER_NAME = 'x-request-id';

// Payment public tokens and booking references are bearer credentials: anyone
// holding one can read that payment or booking. Logs are copied to third-party
// log stores, so the path is logged with those segments masked.
const PAYMENT_PUBLIC_TOKEN_ROUTE_SEGMENT_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const BOOKING_REFERENCE_ROUTE_SEGMENT_PATTERN = /\b[A-HJ-NP-Z2-9]{6}\b/g;

export function redactAttendeeAccessCredentialsFromRequestPath(requestPath) {
  return String(requestPath)
    .replace(PAYMENT_PUBLIC_TOKEN_ROUTE_SEGMENT_PATTERN, ':paymentPublicToken')
    .replace(BOOKING_REFERENCE_ROUTE_SEGMENT_PATTERN, ':bookingReference');
}

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
      path: redactAttendeeAccessCredentialsFromRequestPath(req.originalUrl),
      statusCode: res.statusCode,
      durationMs: Date.now() - requestStartedAtMs,
      ipAddress: req.ip,
    });
  });

  next();
}
