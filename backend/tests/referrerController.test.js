import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import referrerController from '../controller/referrerController.js';

import { registerReferrerInviteIdentity } from '../services/referrerService.js';
import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

function createMockDownloadResponse() {
  const capturedResponse = {
    statusCode: null,
    body: null,
    headers: {},
    sentPayload: null,
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
    setHeader(headerName, headerValue) {
      capturedResponse.headers[headerName] = headerValue;
      return this;
    },
    send(payload) {
      capturedResponse.sentPayload = payload;
      return this;
    },
    capturedResponse,
  };
}

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('TRUNCATE referrers CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

async function createReferrerWithOneClient() {
  const referrerRecord = await registerReferrerInviteIdentity(
    'Neema Mushi',
    '+255712345710'
  );

  await createBookingRecordWithActiveSeatHold({
    full_name: 'Referred Client',
    email: 'referred-client@example.com',
    phone_number: '+255712345711',
    utm_source: referrerRecord.referrer_code,
  });

  return referrerRecord;
}

test('exportReferredClientsAsCsvEndpoint returns a CSV attachment for one referral code', async () => {
  const referrerRecord = await createReferrerWithOneClient();
  const response = createMockDownloadResponse();

  await referrerController.exportReferredClientsAsCsvEndpoint(
    { params: { referrerCode: referrerRecord.referrer_code } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.equal(
    response.capturedResponse.headers['Content-Type'],
    'text/csv; charset=utf-8'
  );
  assert.match(
    response.capturedResponse.headers['Content-Disposition'],
    /^attachment; filename="referred-clients-.*\.csv"$/
  );
  assert.match(response.capturedResponse.sentPayload, /Referred Client/);
  assert.match(response.capturedResponse.sentPayload, /referred-client@example\.com/);
  assert.match(response.capturedResponse.sentPayload, /Neema Mushi/);
});

test('fetchReferredClientsEndpoint returns the clients and the referrer identity', async () => {
  const referrerRecord = await createReferrerWithOneClient();
  const response = createMockDownloadResponse();

  await referrerController.fetchReferredClientsEndpoint(
    { params: { referrerCode: referrerRecord.referrer_code } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.equal(response.capturedResponse.body.referrer.referrer_name, 'Neema Mushi');
  assert.equal(response.capturedResponse.body.clients.length, 1);
  assert.equal(response.capturedResponse.body.clients[0].full_name, 'Referred Client');
});

test('fetchReferredClientsEndpoint answers 404 for a code with no referrer and no bookings', async () => {
  const response = createMockDownloadResponse();

  await referrerController.fetchReferredClientsEndpoint(
    { params: { referrerCode: 'ref_unknown_zzzz' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 404);
});

test('fetchReferredClientsEndpoint rejects a malformed referral code', async () => {
  const response = createMockDownloadResponse();

  await referrerController.fetchReferredClientsEndpoint(
    { params: { referrerCode: '<script>' } },
    response
  );

  assert.equal(response.capturedResponse.statusCode, 400);
});

test('exportReferralSummaryAsCsvEndpoint exports every referral source', async () => {
  await createReferrerWithOneClient();
  const response = createMockDownloadResponse();

  await referrerController.exportReferralSummaryAsCsvEndpoint({}, response);

  assert.equal(response.capturedResponse.statusCode, 200);
  assert.match(response.capturedResponse.sentPayload, /Referrer name,Referral username/);
  assert.match(response.capturedResponse.sentPayload, /Neema Mushi,neema/);
});
