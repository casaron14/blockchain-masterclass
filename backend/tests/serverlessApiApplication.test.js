import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';

import { createScopedApiApplication } from '../serverlessApiApplication.js';

const openScopedApiTestServers = [];

async function startScopedApiTestServer(expressApplication) {
  return new Promise((resolve) => {
    const httpServer = expressApplication.listen(0, () => {
      openScopedApiTestServers.push(httpServer);
      resolve(httpServer);
    });
  });
}

async function sendScopedApiTestRequest(httpServer, requestPath) {
  const serverPort = httpServer.address().port;
  return fetch(`http://localhost:${serverPort}${requestPath}`);
}

after(() => {
  for (const httpServer of openScopedApiTestServers) {
    httpServer.close();
  }
});

test('scoped API application forwards requests to its route group', async () => {
  const scopedApiRouter = express.Router();
  scopedApiRouter.get('/:eventSlug', (request, response) => {
    response.json({ eventSlug: request.params.eventSlug });
  });

  const scopedApiApplication = createScopedApiApplication(
    '/api/events',
    scopedApiRouter
  );
  const httpServer = await startScopedApiTestServer(scopedApiApplication);
  const apiResponse = await sendScopedApiTestRequest(
    httpServer,
    '/api/events/blockchain-masterclass'
  );

  assert.equal(apiResponse.status, 200);
  assert.deepEqual(await apiResponse.json(), {
    eventSlug: 'blockchain-masterclass',
  });
});

test('scoped API application does not dispatch routes outside its group', async () => {
  const scopedApiApplication = createScopedApiApplication(
    '/api/events',
    express.Router()
  );
  const httpServer = await startScopedApiTestServer(scopedApiApplication);
  const apiResponse = await sendScopedApiTestRequest(
    httpServer,
    '/api/bookings/availability'
  );

  assert.equal(apiResponse.status, 404);
  assert.equal(apiResponse.headers.get('content-type')?.includes('application/json'), true);
});
