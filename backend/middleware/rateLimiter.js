import rateLimit from 'express-rate-limit';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const RATE_LIMIT_EXCEEDED_RESPONSE = {
  message: 'Too many requests. Please try again later.',
  error: 'RATE_LIMIT_EXCEEDED',
};

function buildRateLimiterInstance({ requestLimit }) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: requestLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: RATE_LIMIT_EXCEEDED_RESPONSE,
  });
}

export function createStrictBookingRateLimiter() {
  return buildRateLimiterInstance({ requestLimit: 5 });
}

export function createStrictAuthRateLimiter() {
  return buildRateLimiterInstance({ requestLimit: 10 });
}

export function createStrictPaymentInitiationRateLimiter() {
  return buildRateLimiterInstance({ requestLimit: 10 });
}

export function createWebhookInboundRateLimiter() {
  return buildRateLimiterInstance({ requestLimit: 300 });
}

export function createGeneralRequestRateLimiter() {
  return buildRateLimiterInstance({ requestLimit: 200 });
}

// The booking lookup accepts an email address, phone number, or partial name,
// so it gets a tighter ceiling than ordinary reads to blunt attendee
// enumeration while still allowing a few honest corrections.
export function createAttendeeBookingLookupRateLimiter() {
  return buildRateLimiterInstance({ requestLimit: 20 });
}