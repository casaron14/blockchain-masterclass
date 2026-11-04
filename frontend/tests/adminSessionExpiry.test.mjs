import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_TOKEN_EXPIRY_CLOCK_SKEW_MS,
  clampAdminSessionTimerDelayMs,
  decodeAdminTokenPayloadClaims,
  isAdminAuthenticationFailureResponse,
  isAdminTokenExpired,
  notifyAdminSessionExpiryHandlerIfAuthenticationFailed,
  readAdminTokenExpiryTimestamp,
  registerAdminSessionExpiryHandler,
  resolveAdminTokenRemainingLifetimeMs,
} from '../lib/adminSessionExpiry.js';

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function buildUnsignedAdminToken(claims) {
  return [
    encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' }),
    encodeBase64UrlJson(claims),
    'unsigned-signature',
  ].join('.');
}

test('decodeAdminTokenPayloadClaims reads the claims from a JWT payload', () => {
  const adminToken = buildUnsignedAdminToken({
    id: 7,
    isAdmin: true,
    username: 'operator',
  });

  assert.deepEqual(decodeAdminTokenPayloadClaims(adminToken), {
    id: 7,
    isAdmin: true,
    username: 'operator',
  });
});

test('decodeAdminTokenPayloadClaims returns null for malformed tokens', () => {
  assert.equal(decodeAdminTokenPayloadClaims(null), null);
  assert.equal(decodeAdminTokenPayloadClaims('not-a-jwt'), null);
  assert.equal(decodeAdminTokenPayloadClaims('header.%%%.signature'), null);
});

test('readAdminTokenExpiryTimestamp converts the exp claim to milliseconds', () => {
  const adminToken = buildUnsignedAdminToken({ exp: 1_800_000_000 });

  assert.equal(readAdminTokenExpiryTimestamp(adminToken), 1_800_000_000_000);
});

test('readAdminTokenExpiryTimestamp returns null when exp is absent', () => {
  const adminToken = buildUnsignedAdminToken({ id: 7 });

  assert.equal(readAdminTokenExpiryTimestamp(adminToken), null);
});

test('isAdminTokenExpired is false before the expiry and true at the skew boundary', () => {
  const expiryTimestampMs = 1_800_000_000_000;
  const adminToken = buildUnsignedAdminToken({
    exp: expiryTimestampMs / 1000,
  });

  assert.equal(
    isAdminTokenExpired(adminToken, expiryTimestampMs - 60_000),
    false
  );
  assert.equal(
    isAdminTokenExpired(adminToken, expiryTimestampMs - ADMIN_TOKEN_EXPIRY_CLOCK_SKEW_MS),
    true
  );
  assert.equal(isAdminTokenExpired(adminToken, expiryTimestampMs + 1), true);
});

test('isAdminTokenExpired never signs out a token without a readable exp claim', () => {
  assert.equal(isAdminTokenExpired('opaque-token', Date.now()), false);
  assert.equal(
    isAdminTokenExpired(buildUnsignedAdminToken({ id: 7 }), Date.now()),
    false
  );
});

test('resolveAdminTokenRemainingLifetimeMs subtracts the clock skew and never goes negative', () => {
  const expiryTimestampMs = 1_800_000_000_000;
  const adminToken = buildUnsignedAdminToken({
    exp: expiryTimestampMs / 1000,
  });

  assert.equal(
    resolveAdminTokenRemainingLifetimeMs(adminToken, expiryTimestampMs - 60_000),
    60_000 - ADMIN_TOKEN_EXPIRY_CLOCK_SKEW_MS
  );
  assert.equal(
    resolveAdminTokenRemainingLifetimeMs(adminToken, expiryTimestampMs + 60_000),
    0
  );
});

test('clampAdminSessionTimerDelayMs keeps the delay inside the setTimeout range', () => {
  assert.equal(clampAdminSessionTimerDelayMs(2_000), 2_000);
  assert.equal(clampAdminSessionTimerDelayMs(0), 0);
  assert.equal(clampAdminSessionTimerDelayMs(-5), 0);
  assert.equal(clampAdminSessionTimerDelayMs(Number.POSITIVE_INFINITY), 0);
  assert.equal(
    clampAdminSessionTimerDelayMs(5_000_000_000),
    2_147_483_647
  );
});

test('isAdminAuthenticationFailureResponse only treats rejected sessions as expiry', () => {
  assert.equal(
    isAdminAuthenticationFailureResponse(403, {
      message: 'Invalid or expired token',
    }),
    true
  );
  assert.equal(
    isAdminAuthenticationFailureResponse(401, {
      message: 'Authorization token missing',
    }),
    true
  );
  assert.equal(
    isAdminAuthenticationFailureResponse(403, {
      message: 'Admin access required',
    }),
    false
  );
  assert.equal(
    isAdminAuthenticationFailureResponse(400, {
      message: 'Invalid or expired token',
    }),
    false
  );
});

test('notifyAdminSessionExpiryHandlerIfAuthenticationFailed calls the registered handler once per expiry response', () => {
  let handledExpiryCount = 0;
  const unregisterHandler = registerAdminSessionExpiryHandler(() => {
    handledExpiryCount += 1;
  });

  try {
    assert.equal(
      notifyAdminSessionExpiryHandlerIfAuthenticationFailed(403, {
        message: 'Invalid or expired token',
      }),
      true
    );
    assert.equal(
      notifyAdminSessionExpiryHandlerIfAuthenticationFailed(403, {
        message: 'Admin access required',
      }),
      false
    );
    assert.equal(handledExpiryCount, 1);
  } finally {
    unregisterHandler();
  }

  assert.equal(
    notifyAdminSessionExpiryHandlerIfAuthenticationFailed(403, {
      message: 'Invalid or expired token',
    }),
    false
  );
  assert.equal(handledExpiryCount, 1);
});
