import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Joi from 'joi';

import {
  buildSecurityHeaders,
  buildCorsPolicy,
} from '../middleware/httpSecurityMiddleware.js';
import handleApplicationError, { handleNotFoundRoute } from '../middleware/errorHandler.js';
import { validatePositiveIntegerRouteParam } from '../middleware/requestValidators.js';

const openTestServers = [];

async function startSecurityTestServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      openTestServers.push(server);
      resolve(server);
    });
  });
}

async function sendSecurityRequest(server, requestPath, requestOptions = {}) {
  const port = server.address().port;
  return fetch(`http://localhost:${port}${requestPath}`, requestOptions);
}

function buildHardenedApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(buildSecurityHeaders());
  app.use(buildCorsPolicy());
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use(handleNotFoundRoute);
  app.use(handleApplicationError);
  return app;
}

after(() => {
  for (const server of openTestServers) {
    server.close();
  }
});

test('hardened app sends security headers and omits the x-powered-by header', async () => {
  const server = await startSecurityTestServer(buildHardenedApp());
  const response = await sendSecurityRequest(server, '/health');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('permissions-policy'), /geolocation=\(\)/);
});

test('CORS policy accepts a configured local origin', async () => {
  const server = await startSecurityTestServer(buildHardenedApp());
  const response = await sendSecurityRequest(server, '/health', {
    headers: { Origin: 'http://localhost:3000' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});

test('CORS policy rejects requests from origins not in the allowlist', async () => {
  const server = await startSecurityTestServer(buildHardenedApp());
  const response = await sendSecurityRequest(server, '/health', {
    headers: { Origin: 'http://evil.example.com' },
  });

  assert.equal(response.status, 403);
});

test('unknown routes return a JSON 404 response', async () => {
  const server = await startSecurityTestServer(buildHardenedApp());
  const response = await sendSecurityRequest(server, '/definitely-not-a-route');
  const responseBody = await response.json();

  assert.equal(response.status, 404);
  assert.equal(responseBody.error, 'NOT_FOUND');
  assert.equal(response.headers.get('content-type').startsWith('application/json'), true);
});

test('error handler maps exceeded JSON body limits to 413', async () => {
  const app = express();
  app.use(express.json({ limit: '10' }));
  app.post('/submit', (req, res) => res.json({ received: true }));
  app.use(handleNotFoundRoute);
  app.use(handleApplicationError);

  const server = await startSecurityTestServer(app);
  const response = await sendSecurityRequest(server, '/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oversizedField: 'this payload is far larger than ten bytes' }),
  });
  const responseBody = await response.json();

  assert.equal(response.status, 413);
  assert.equal(responseBody.error, 'PAYLOAD_TOO_LARGE');
});

test('error handler maps Joi validation errors to 400', async () => {
  const app = express();
  app.get('/invalid', () => {
    throw new Joi.ValidationError(
      'Validation error',
      [{ message: 'phone_number is not allowed to be empty', path: ['phone_number'], type: 'string.empty' }],
      {}
    );
  });
  app.use(handleNotFoundRoute);
  app.use(handleApplicationError);

  const server = await startSecurityTestServer(app);
  const response = await sendSecurityRequest(server, '/invalid');
  const responseBody = await response.json();

  assert.equal(response.status, 400);
  assert.equal(responseBody.error, 'phone_number is not allowed to be empty');
});

test('error handler does not leak internal error messages in production', async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const app = express();
    app.get('/boom', () => {
      throw new Error('internal-database-password-leak-marker');
    });
    app.use(handleApplicationError);

    const server = await startSecurityTestServer(app);
    const response = await sendSecurityRequest(server, '/boom');
    const responseBody = await response.json();

    assert.equal(response.status, 500);
    assert.equal(responseBody.message, 'Internal server error');
    assert.equal(responseBody.error, 'INTERNAL_ERROR');
  } finally {
    process.env.NODE_ENV = previousNodeEnvironment;
  }
});

test('validatePositiveIntegerRouteParam accepts a valid integer id', () => {
  const request = { params: { id: '42' } };
  let nextCalled = false;

  validatePositiveIntegerRouteParam('id')(request, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(request.params.id, 42);
});

test('validatePositiveIntegerRouteParam rejects non-numeric, zero, negative, and fractional ids', () => {
  for (const invalidValue of ['abc', '0', '-3', '1.5', '']) {
    const request = { params: { id: invalidValue } };
    let nextCalled = false;
    let responseStatus = null;
    let responseBody = null;
    const responseMock = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    validatePositiveIntegerRouteParam('id')(request, responseMock, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, `expected next() to be skipped for "${invalidValue}"`);
    assert.equal(responseStatus, 400);
    assert.equal(responseBody.error, 'INVALID_ROUTE_PARAM');
  }
});