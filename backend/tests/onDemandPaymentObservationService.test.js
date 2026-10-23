import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import { refreshUsdtPaymentObservationOnDemand } from '../services/onDemandPaymentObservationService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

test('an on-demand refresh for a missing payment reports it without scanning the chain', async () => {
  const refreshResult = await refreshUsdtPaymentObservationOnDemand(987654321);

  assert.equal(refreshResult.paymentRecord, null);
  assert.equal(refreshResult.didRunScan, false);
  assert.equal(refreshResult.reason, 'PAYMENT_NOT_FOUND');
});
