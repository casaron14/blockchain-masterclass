import { test } from 'node:test';
import assert from 'node:assert/strict';

import eventController from '../controller/eventController.js';

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

test('getEventConfigurationBySlug returns 404 for an unknown event slug', async () => {
  const response = createMockResponse();

  await eventController.getEventConfigurationBySlug(
    { params: { slug: 'unknown-event' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
  assert.equal(response.capturedResponse.body.message, 'Event not found');
});
