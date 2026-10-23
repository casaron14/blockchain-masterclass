import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import cronController, { matchesCronSecret } from '../controller/cronController.js';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

function createMockResponse() {
  const capturedResponse = { statusCode: null, body: null };

  return {
    status(statusCode) {
      capturedResponse.statusCode = statusCode;
      return this;
    },
    json(body) {
      capturedResponse.body = body;
      return this;
    },
    capturedResponse,
  };
}

test('matchesCronSecret requires the exact bearer header', () => {
  assert.equal(matchesCronSecret('Bearer s3cret-value', 's3cret-value'), true);
  assert.equal(matchesCronSecret('s3cret-value', 's3cret-value'), false);
  assert.equal(matchesCronSecret('Bearer wrong-value', 's3cret-value'), false);
  assert.equal(matchesCronSecret(undefined, 's3cret-value'), false);
});

test('the scheduled job endpoint fails closed when CRON_SECRET is missing', async () => {
  delete process.env.CRON_SECRET;
  const response = createMockResponse();

  await cronController.runScheduledJobTickEndpoint({ headers: {} }, response);

  assert.equal(response.capturedResponse.statusCode, 503);
  assert.equal(response.capturedResponse.body.error, 'CRON_NOT_CONFIGURED');
});

test('the scheduled job endpoint rejects a wrong scheduler secret', async () => {
  process.env.CRON_SECRET = 'expected-scheduler-secret';
  const response = createMockResponse();

  await cronController.runScheduledJobTickEndpoint(
    { headers: { authorization: 'Bearer not-the-secret' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 401);
  assert.equal(response.capturedResponse.body.error, 'CRON_UNAUTHORIZED');
});
