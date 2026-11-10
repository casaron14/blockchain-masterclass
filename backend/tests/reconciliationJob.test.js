import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runReconciliationJob,
  RECONCILIATION_SKIPPED_RECENT_RUN,
} from '../jobs/reconciliationJob.js';
import { RECONCILIATION_STATUS_BALANCED } from '../services/reconciliationService.js';

test('the reconciliation job skips when a run started less than 23 hours ago', async () => {
  let reconciliationRan = false;

  const jobResult = await runReconciliationJob({
    fetchMostRecentRun: async () => ({
      started_at: new Date('2026-01-02T12:00:00.000Z'),
    }),
    runReconciliation: async () => {
      reconciliationRan = true;
      return { status: RECONCILIATION_STATUS_BALANCED, balanced: true };
    },
    now: new Date('2026-01-03T00:00:00.000Z'),
    alertOnMismatch: async () => {},
  });

  assert.equal(jobResult.skipped, true);
  assert.equal(jobResult.reason, RECONCILIATION_SKIPPED_RECENT_RUN);
  assert.equal(jobResult.hoursSinceLastRun, 12);
  assert.equal(reconciliationRan, false, 'a recent audit must not run again');
});

test('the reconciliation job runs when the last run is older than 23 hours', async () => {
  const expectedStartTime = new Date('2026-01-03T00:00:00.000Z');
  let receivedStartTime = null;

  const jobResult = await runReconciliationJob({
    fetchMostRecentRun: async () => ({
      started_at: new Date('2026-01-01T00:00:00.000Z'),
    }),
    runReconciliation: async ({ startedAt }) => {
      receivedStartTime = startedAt;
      return {
        status: RECONCILIATION_STATUS_BALANCED,
        balanced: true,
        confirmedDepositsUsdt: 0,
        inFlightDepositsUsdt: 0,
        settledDepositsUsdt: 0,
        treasuryLedgerUsdt: 0,
        onChainTreasuryUsdt: 0,
      };
    },
    now: expectedStartTime,
    alertOnMismatch: async () => {},
  });

  assert.equal(jobResult.skipped, undefined);
  assert.equal(jobResult.balanced, true);
  assert.deepEqual(receivedStartTime, expectedStartTime);
});

test('the reconciliation job runs when no previous run exists', async () => {
  let reconciliationRan = false;

  await runReconciliationJob({
    fetchMostRecentRun: async () => null,
    runReconciliation: async () => {
      reconciliationRan = true;
      return { status: RECONCILIATION_STATUS_BALANCED, balanced: true };
    },
    now: new Date('2026-01-03T00:00:00.000Z'),
    alertOnMismatch: async () => {},
  });

  assert.equal(reconciliationRan, true);
});
