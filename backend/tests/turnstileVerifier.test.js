import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyTurnstileTokenWithCloudflare,
  verifyTurnstileChallengeToken,
} from '../middleware/turnstileVerifier.js';

const PRODUCTION_ENVIRONMENT = 'production';
const DEVELOPMENT_ENVIRONMENT = 'development';

function createMockResponse({ ok, body }) {
  return {
    ok,
    json: async () => body,
  };
}

function createMockRequest({ body, ip }) {
  return { body, ip };
}

function createMockResponseSender() {
  const mockResponse = {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return mockResponse;
}

beforeEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NODE_ENV;
  delete globalThis.fetch;
});

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NODE_ENV;
  delete globalThis.fetch;
});

test('verifyTurnstileTokenWithCloudflare posts secret and challenge token to siteverify', async () => {
  let sentRequestPayload = null;
  let sentRequestOptions = null;

  const stubFetchImplementation = async (endpointUrl, requestOptions) => {
    sentRequestPayload = requestOptions.body;
    sentRequestOptions = requestOptions;
    return createMockResponse({ ok: true, body: { success: true } });
  };

  const verificationOutcome = await verifyTurnstileTokenWithCloudflare({
    secretKey: 'test-secret-key',
    challengeToken: 'test-challenge-token',
    fetchImplementation: stubFetchImplementation,
  });

  assert.equal(verificationOutcome.success, true);
  assert.equal(verificationOutcome.errorCodes.length, 0);
  assert.equal(sentRequestPayload.get('secret'), 'test-secret-key');
  assert.equal(sentRequestPayload.get('response'), 'test-challenge-token');
  assert.equal(sentRequestOptions.method, 'POST');
});

test('verifyTurnstileTokenWithCloudflare includes remoteip when provided', async () => {
  let sentRequestPayload = null;

  const stubFetchImplementation = async (endpointUrl, requestOptions) => {
    sentRequestPayload = requestOptions.body;
    return createMockResponse({ ok: true, body: { success: true } });
  };

  await verifyTurnstileTokenWithCloudflare({
    secretKey: 'test-secret-key',
    challengeToken: 'test-challenge-token',
    remoteIp: '203.0.113.10',
    fetchImplementation: stubFetchImplementation,
  });

  assert.equal(sentRequestPayload.get('remoteip'), '203.0.113.10');
});

test('verifyTurnstileTokenWithCloudflare reports failure with error codes from siteverify', async () => {
  const stubFetchImplementation = async () =>
    createMockResponse({
      ok: true,
      body: { success: false, 'error-codes': ['invalid-input-response'] },
    });

  const verificationOutcome = await verifyTurnstileTokenWithCloudflare({
    secretKey: 'test-secret-key',
    challengeToken: 'expired-or-invalid-token',
    fetchImplementation: stubFetchImplementation,
  });

  assert.equal(verificationOutcome.success, false);
  assert.deepEqual(verificationOutcome.errorCodes, ['invalid-input-response']);
});

test('verifyTurnstileTokenWithCloudflare treats a non-ok siteverify response as failure', async () => {
  const stubFetchImplementation = async () =>
    createMockResponse({ ok: false, body: { detail: 'upstream error' } });

  const verificationOutcome = await verifyTurnstileTokenWithCloudflare({
    secretKey: 'test-secret-key',
    challengeToken: 'test-challenge-token',
    fetchImplementation: stubFetchImplementation,
  });

  assert.equal(verificationOutcome.success, false);
  assert.deepEqual(verificationOutcome.errorCodes, ['siteverify-http-error']);
});

test('verifyTurnstileChallengeToken skips verification when secret is unset outside production', async () => {
  process.env.NODE_ENV = DEVELOPMENT_ENVIRONMENT;

  let nextWasCalled = false;
  const mockResponse = createMockResponseSender();
  const mockNext = () => {
    nextWasCalled = true;
  };

  await verifyTurnstileChallengeToken(createMockRequest({ body: {} }), mockResponse, mockNext);

  assert.equal(nextWasCalled, true);
  assert.equal(mockResponse.statusCode, null);
});

test('verifyTurnstileChallengeToken rejects with 503 when secret is unset in production', async () => {
  process.env.NODE_ENV = PRODUCTION_ENVIRONMENT;

  const mockResponse = createMockResponseSender();
  let nextWasCalled = false;
  const mockNext = () => {
    nextWasCalled = true;
  };

  await verifyTurnstileChallengeToken(createMockRequest({ body: {} }), mockResponse, mockNext);

  assert.equal(nextWasCalled, false);
  assert.equal(mockResponse.statusCode, 503);
  assert.equal(mockResponse.body.error, 'TURNSTILE_NOT_CONFIGURED');
});

test('verifyTurnstileChallengeToken rejects with 400 when the challenge token is missing', async () => {
  process.env.NODE_ENV = DEVELOPMENT_ENVIRONMENT;
  process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

  const mockResponse = createMockResponseSender();
  let nextWasCalled = false;
  const mockNext = () => {
    nextWasCalled = true;
  };

  await verifyTurnstileChallengeToken(
    createMockRequest({ body: { full_name: 'No Token Here' } }),
    mockResponse,
    mockNext
  );

  assert.equal(nextWasCalled, false);
  assert.equal(mockResponse.statusCode, 400);
  assert.equal(mockResponse.body.error, 'TURNSTILE_TOKEN_REQUIRED');
});

test('verifyTurnstileChallengeToken calls next() when siteverify approves the token', async () => {
  process.env.NODE_ENV = DEVELOPMENT_ENVIRONMENT;
  process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
  globalThis.fetch = async () =>
    createMockResponse({ ok: true, body: { success: true } });

  const mockResponse = createMockResponseSender();
  let nextWasCalled = false;
  const mockNext = () => {
    nextWasCalled = true;
  };

  await verifyTurnstileChallengeToken(
    createMockRequest({
      body: { cf_turnstile_response: 'valid-challenge-token' },
      ip: '203.0.113.5',
    }),
    mockResponse,
    mockNext
  );

  assert.equal(nextWasCalled, true);
  assert.equal(mockResponse.statusCode, null);
});

test('verifyTurnstileChallengeToken rejects with 403 when siteverify fails the token', async () => {
  process.env.NODE_ENV = DEVELOPMENT_ENVIRONMENT;
  process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
  globalThis.fetch = async () =>
    createMockResponse({
      ok: true,
      body: { success: false, 'error-codes': ['timeout-or-duplicate'] },
    });

  const mockResponse = createMockResponseSender();
  let nextWasCalled = false;
  const mockNext = () => {
    nextWasCalled = true;
  };

  await verifyTurnstileChallengeToken(
    createMockRequest({ body: { cf_turnstile_response: 'used-challenge-token' } }),
    mockResponse,
    mockNext
  );

  assert.equal(nextWasCalled, false);
  assert.equal(mockResponse.statusCode, 403);
  assert.equal(mockResponse.body.error, 'TURNSTILE_VERIFICATION_FAILED');
});

test('verifyTurnstileChallengeToken returns 500 when siteverify is unreachable', async () => {
  process.env.NODE_ENV = DEVELOPMENT_ENVIRONMENT;
  process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
  globalThis.fetch = async () => {
    throw new Error('network unreachable');
  };

  const mockResponse = createMockResponseSender();
  let nextWasCalled = false;
  const mockNext = () => {
    nextWasCalled = true;
  };

  await verifyTurnstileChallengeToken(
    createMockRequest({ body: { cf_turnstile_response: 'valid-challenge-token' } }),
    mockResponse,
    mockNext
  );

  assert.equal(nextWasCalled, false);
  assert.equal(mockResponse.statusCode, 500);
  assert.equal(mockResponse.body.error, 'TURNSTILE_VERIFICATION_UNAVAILABLE');
});