import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  createStrictBookingRateLimiter,
  createGeneralRequestRateLimiter,
} from '../middleware/rateLimiter.js';

const openTestServers = [];

async function startRateLimitedTestServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      openTestServers.push(server);
      resolve(server);
    });
  });
}

function buildBookingLimitApp() {
  const app = express();
  const strictBookingLimiter = createStrictBookingRateLimiter();
  app.post('/book', strictBookingLimiter, (req, res) => {
    res.status(201).json({ message: 'booking created' });
  });
  return app;
}

function buildGeneralLimitApp() {
  const app = express();
  const generalLimiter = createGeneralRequestRateLimiter();
  app.get('/events', generalLimiter, (req, res) => {
    res.status(200).json({ message: 'event config' });
  });
  return app;
}

async function sendPostRequest(server, path, requestCount) {
  const port = server.address().port;
  const statuses = [];
  for (let requestIndex = 0; requestIndex < requestCount; requestIndex += 1) {
    const response = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
    });
    statuses.push(response.status);
  }
  return statuses;
}

async function sendGetRequest(server, path, requestCount) {
  const port = server.address().port;
  const statuses = [];
  for (let requestIndex = 0; requestIndex < requestCount; requestIndex += 1) {
    const response = await fetch(`http://localhost:${port}${path}`);
    statuses.push(response.status);
  }
  return statuses;
}

after(async () => {
  await Promise.all(
    openTestServers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        })
    )
  );
});

test('strict booking limiter allows 5 requests then blocks the 6th with 429', async () => {
  const server = await startRateLimitedTestServer(buildBookingLimitApp());

  const statuses = await sendPostRequest(server, '/book', 6);

  assert.deepEqual(
    statuses.slice(0, 5),
    [201, 201, 201, 201, 201],
    'the first 5 booking requests should pass'
  );
  assert.equal(statuses[5], 429, 'the 6th booking request from the same IP should be rate limited');
});

test('general request limiter does not block a normal read request burst', async () => {
  const server = await startRateLimitedTestServer(buildGeneralLimitApp());

  const statuses = await sendGetRequest(server, '/events', 5);

  assert.deepEqual(
    statuses,
    [200, 200, 200, 200, 200],
    'a normal burst of read requests should pass the general limiter'
  );
});