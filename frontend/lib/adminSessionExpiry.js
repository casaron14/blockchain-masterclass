// The admin session is a signed JWT kept in localStorage and sent as a bearer
// token. Nothing in the browser knows when it stops being valid unless we read
// the `exp` claim, so every expiry decision lives in this module: it lets the
// admin context sign the session out on time and lets the API layer treat a
// rejected token as the same event.

// Sign the admin out slightly early so a request that starts just before the
// deadline cannot reach the server after it. The server is still the source of
// truth; this only removes an avoidable failed request.
export const ADMIN_TOKEN_EXPIRY_CLOCK_SKEW_MS = 5_000;

// setTimeout cannot wait longer than this. A token with a longer lifetime is
// re-checked in chunks instead of overflowing the timer and firing instantly.
const MAXIMUM_SINGLE_TIMER_DELAY_MS = 2_147_483_647;

function decodeBase64UrlSegmentToUtf8Text(base64UrlSegment) {
  const base64Text = base64UrlSegment.replace(/-/g, '+').replace(/_/g, '/');
  const paddedBase64Text = base64Text.padEnd(
    Math.ceil(base64Text.length / 4) * 4,
    '='
  );

  const binaryText = atob(paddedBase64Text);
  const binaryBytes = Uint8Array.from(binaryText, (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(binaryBytes);
}

export function decodeAdminTokenPayloadClaims(adminToken) {
  if (typeof adminToken !== 'string') {
    return null;
  }

  const tokenSegments = adminToken.split('.');
  if (tokenSegments.length !== 3 || !tokenSegments[1]) {
    return null;
  }

  try {
    const decodedClaims = JSON.parse(
      decodeBase64UrlSegmentToUtf8Text(tokenSegments[1])
    );
    return decodedClaims && typeof decodedClaims === 'object'
      ? decodedClaims
      : null;
  } catch {
    return null;
  }
}

// Returns the expiry as a millisecond timestamp, or null when the token is
// opaque or malformed. A null expiry must be treated as "unknown", never as
// "expired", so a format change cannot sign an operator out immediately.
export function readAdminTokenExpiryTimestamp(adminToken) {
  const decodedClaims = decodeAdminTokenPayloadClaims(adminToken);
  return typeof decodedClaims?.exp === 'number'
    ? decodedClaims.exp * 1000
    : null;
}

export function resolveAdminTokenRemainingLifetimeMs(
  adminToken,
  currentTimestamp = Date.now()
) {
  const expiryTimestamp = readAdminTokenExpiryTimestamp(adminToken);
  if (expiryTimestamp === null) {
    return null;
  }
  return Math.max(
    0,
    expiryTimestamp - ADMIN_TOKEN_EXPIRY_CLOCK_SKEW_MS - currentTimestamp
  );
}

export function isAdminTokenExpired(adminToken, currentTimestamp = Date.now()) {
  const remainingLifetimeMs = resolveAdminTokenRemainingLifetimeMs(
    adminToken,
    currentTimestamp
  );
  return remainingLifetimeMs === 0;
}

// Clamp the expiry timer so a lifetime longer than setTimeout supports is
// re-armed in chunks rather than firing immediately.
export function clampAdminSessionTimerDelayMs(remainingLifetimeMs) {
  if (!Number.isFinite(remainingLifetimeMs) || remainingLifetimeMs <= 0) {
    return 0;
  }
  return Math.min(remainingLifetimeMs, MAXIMUM_SINGLE_TIMER_DELAY_MS);
}

// The API reports a rejected session as "Authorization token missing" (401) or
// "Invalid or expired token" (403). Other 401/403 responses are permission
// problems that must not destroy a still-valid session.
export function isAdminAuthenticationFailureResponse(
  responseStatus,
  responseBody
) {
  const responseMessage = String(responseBody?.message || '');
  if (responseStatus === 401) {
    return /authorization token missing/i.test(responseMessage);
  }
  if (responseStatus === 403) {
    return /invalid or expired token/i.test(responseMessage);
  }
  return false;
}

let registeredAdminSessionExpiryHandler = null;

// The API module cannot reach React state, so the admin context registers the
// callback that clears the session. Returns an unregister function for cleanup.
export function registerAdminSessionExpiryHandler(handler) {
  registeredAdminSessionExpiryHandler =
    typeof handler === 'function' ? handler : null;

  return () => {
    if (registeredAdminSessionExpiryHandler === handler) {
      registeredAdminSessionExpiryHandler = null;
    }
  };
}

export function notifyAdminSessionExpiryHandlerIfAuthenticationFailed(
  responseStatus,
  responseBody
) {
  if (
    registeredAdminSessionExpiryHandler &&
    isAdminAuthenticationFailureResponse(responseStatus, responseBody)
  ) {
    registeredAdminSessionExpiryHandler();
    return true;
  }
  return false;
}
