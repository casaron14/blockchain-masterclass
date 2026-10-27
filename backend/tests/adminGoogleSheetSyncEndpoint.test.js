import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import adminController from '../controller/adminController.js';
import { createAdminBookingRecord } from '../services/adminBookingService.js';

const TEST_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycb-test-deployment-id/exec';
const TEST_SHARED_SECRET = 'test-shared-secret-value';

function createMockResponse() {
  const capturedResponse = {
    statusCode: null,
    body: null,
  };

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

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query(
    'UPDATE seat_capacity SET confirmed_count = 0, cap = 150 WHERE id = 1'
  );
}

async function withWebhookEnvironment(environmentValues, testBody) {
  const previousValues = {};

  for (const variableName of Object.keys(environmentValues)) {
    previousValues[variableName] = process.env[variableName];
    if (environmentValues[variableName] === undefined) {
      delete process.env[variableName];
    } else {
      process.env[variableName] = environmentValues[variableName];
    }
  }

  try {
    return await testBody();
  } finally {
    for (const variableName of Object.keys(environmentValues)) {
      if (previousValues[variableName] === undefined) {
        delete process.env[variableName];
      } else {
        process.env[variableName] = previousValues[variableName];
      }
    }
  }
}

beforeEach(resetDatabaseState);

test('syncAdminBookingsToGoogleSheetEndpoint answers 503 when the Apps Script webhook is not configured', async () => {
  await withWebhookEnvironment(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL: undefined,
      APPS_SCRIPT_SHARED_SECRET: undefined,
    },
    async () => {
      const mockResponse = createMockResponse();

      await adminController.syncAdminBookingsToGoogleSheetEndpoint(
        {},
        mockResponse
      );

      assert.equal(mockResponse.capturedResponse.statusCode, 503);
      assert.equal(
        mockResponse.capturedResponse.body.error,
        'APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED'
      );
    }
  );
});

test('syncAdminBookingsToGoogleSheetEndpoint explains when the deployed Apps Script is too old', async () => {
  await createAdminBookingRecord({
    full_name: 'Old Deployment Attendee',
    email: 'old-deployment@example.com',
    phone_number: '+255700000098',
    utm_source: null,
  });

  await withWebhookEnvironment(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL: TEST_WEBHOOK_URL,
      APPS_SCRIPT_SHARED_SECRET: TEST_SHARED_SECRET,
    },
    async () => {
      const previousFetchImplementation = globalThis.fetch;

      globalThis.fetch = async () => ({
        status: 200,
        text: async () =>
          JSON.stringify({ ok: false, error: 'delivery_metadata_missing' }),
      });

      try {
        const mockResponse = createMockResponse();

        await adminController.syncAdminBookingsToGoogleSheetEndpoint(
          {},
          mockResponse
        );

        assert.equal(mockResponse.capturedResponse.statusCode, 502);
        assert.deepEqual(mockResponse.capturedResponse.body.failureReasons, [
          'delivery_metadata_missing',
        ]);
        assert.match(
          mockResponse.capturedResponse.body.message,
          /deploy a new version/i
        );
      } finally {
        globalThis.fetch = previousFetchImplementation;
      }
    }
  );
});

test('syncAdminBookingsToGoogleSheetEndpoint sends every booking to the Apps Script web app', async () => {
  const createdBooking = await createAdminBookingRecord({
    full_name: 'Sheet Sync Attendee',
    email: 'sheet-sync@example.com',
    phone_number: '+255700000099',
    utm_source: 'instagram',
  });

  await withWebhookEnvironment(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL: TEST_WEBHOOK_URL,
      APPS_SCRIPT_SHARED_SECRET: TEST_SHARED_SECRET,
    },
    async () => {
      const capturedFetchRequests = [];
      const previousFetchImplementation = globalThis.fetch;

      globalThis.fetch = async (requestUrl, requestOptions) => {
        capturedFetchRequests.push({
          requestUrl,
          requestBody: JSON.parse(requestOptions.body),
        });

        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              requestType: 'sync_bookings',
              syncedCount: 1,
              createdCount: 1,
              updatedCount: 0,
            }),
        };
      };

      try {
        const mockResponse = createMockResponse();

        await adminController.syncAdminBookingsToGoogleSheetEndpoint(
          {},
          mockResponse
        );

        assert.equal(mockResponse.capturedResponse.statusCode, 200);
        assert.equal(
          mockResponse.capturedResponse.body.message,
          'Synced 1 booking to Google Sheets.'
        );
        assert.equal(capturedFetchRequests.length, 1);
        assert.equal(capturedFetchRequests[0].requestUrl, TEST_WEBHOOK_URL);
        assert.equal(
          capturedFetchRequests[0].requestBody.sharedSecret,
          TEST_SHARED_SECRET
        );
        assert.equal(
          capturedFetchRequests[0].requestBody.requestType,
          'sync_bookings'
        );
        assert.equal(
          capturedFetchRequests[0].requestBody.bookings[0].bookingReference,
          createdBooking.ref
        );
      } finally {
        globalThis.fetch = previousFetchImplementation;
      }
    }
  );
});
