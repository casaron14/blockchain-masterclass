import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  USDT_LISTENER_HEALTHY,
  USDT_LISTENER_NEVER_SCANNED,
  USDT_LISTENER_REPEATED_SCAN_FAILURES,
  USDT_LISTENER_SCAN_OVERDUE,
  buildUsdtListenerStallAlertMessage,
  evaluateUsdtListenerHealth,
} from '../services/listenerHealthService.js';

import {
  USDT_LISTENER_HEALTH_CHECK_FAILED,
  runListenerHealthCheckJob,
} from '../jobs/listenerHealthCheckJob.js';

const PROCESS_STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const STALL_THRESHOLD_MS = 60_000;
const FAILURE_LIMIT = 3;
const REALERT_INTERVAL_MS = 30 * 60 * 1000;

function buildAlertState() {
  return { lastAlertedAtMs: null, lastAlertedReason: null };
}

function buildHealthOptions(now, overrides = {}) {
  return {
    now,
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    processStartedAt: PROCESS_STARTED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.MONITOR_POLL_INTERVAL_MS;
  delete process.env.MONITOR_STALL_ALERT_POLL_INTERVALS;
  delete process.env.MONITOR_STALL_ALERT_FAILURE_LIMIT;
  delete process.env.MONITOR_STALL_ALERT_REALERT_MS;
});

test('a listener that completed a recent scan is healthy', () => {
  const health = evaluateUsdtListenerHealth({
    scanState: {
      lastScannedAt: new Date('2026-01-01T00:00:30.000Z'),
      consecutiveFailures: 0,
      lastError: null,
    },
    ...buildHealthOptions(new Date('2026-01-01T00:01:00.000Z')),
  });

  assert.equal(health.healthy, true);
  assert.equal(health.stalled, false);
  assert.equal(health.reason, USDT_LISTENER_HEALTHY);
  assert.equal(health.secondsSinceLastScan, 30);
});

test('a listener whose last successful scan is older than the threshold is stalled', () => {
  const health = evaluateUsdtListenerHealth({
    scanState: {
      lastScannedAt: new Date('2026-01-01T00:00:00.000Z'),
      consecutiveFailures: 1,
      lastError: 'rate limited',
    },
    ...buildHealthOptions(new Date('2026-01-01T00:05:00.000Z')),
  });

  assert.equal(health.healthy, false);
  assert.equal(health.stalled, true);
  assert.equal(health.reason, USDT_LISTENER_SCAN_OVERDUE);
  assert.equal(health.secondsSinceLastScan, 300);
  assert.equal(health.lastError, 'rate limited');
});

test('repeated scan failures are reported even when the last success is recent', () => {
  const health = evaluateUsdtListenerHealth({
    scanState: {
      lastScannedAt: new Date('2026-01-01T00:00:55.000Z'),
      consecutiveFailures: FAILURE_LIMIT,
      lastError: 'connection reset',
    },
    ...buildHealthOptions(new Date('2026-01-01T00:01:00.000Z')),
  });

  assert.equal(health.stalled, true);
  assert.equal(health.reason, USDT_LISTENER_REPEATED_SCAN_FAILURES);
  assert.equal(health.consecutiveFailures, FAILURE_LIMIT);
});

test('a listener that has never scanned is left alone during startup and flagged once the threshold passes', () => {
  const startupHealth = evaluateUsdtListenerHealth({
    scanState: { lastScannedAt: null, consecutiveFailures: 0, lastError: null },
    ...buildHealthOptions(new Date('2026-01-01T00:00:30.000Z')),
  });
  assert.equal(startupHealth.healthy, true);
  assert.equal(startupHealth.stalled, false);

  const stuckHealth = evaluateUsdtListenerHealth({
    scanState: { lastScannedAt: null, consecutiveFailures: 0, lastError: null },
    ...buildHealthOptions(new Date('2026-01-01T00:05:00.000Z')),
  });
  assert.equal(stuckHealth.stalled, true);
  assert.equal(stuckHealth.reason, USDT_LISTENER_NEVER_SCANNED);
  assert.equal(stuckHealth.secondsSinceLastScan, null);
});

test('the stall message names the reason and keeps the last recorded error', () => {
  const overdueMessage = buildUsdtListenerStallAlertMessage({
    reason: USDT_LISTENER_SCAN_OVERDUE,
    secondsSinceLastScan: 300,
    stallThresholdMs: STALL_THRESHOLD_MS,
    lastError: 'rate limited',
  });
  assert.match(overdueMessage, /has not completed a scan for 300s/);
  assert.match(overdueMessage, /threshold 60s/);
  assert.match(overdueMessage, /rate limited/);

  const repeatedMessage = buildUsdtListenerStallAlertMessage({
    reason: USDT_LISTENER_REPEATED_SCAN_FAILURES,
    consecutiveFailures: 4,
    consecutiveFailureLimit: 3,
    stallThresholdMs: STALL_THRESHOLD_MS,
    lastError: 'connection reset',
  });
  assert.match(repeatedMessage, /failed 4 consecutive scan\(s\)/);
  assert.match(repeatedMessage, /limit 3/);
});

test('the health job alerts once per stall episode and resets after recovery', async () => {
  const alertMessages = [];
  const alertState = buildAlertState();
  const stallNow = new Date('2026-01-01T00:10:00.000Z');
  const stalledScanState = {
    lastScannedAt: new Date('2026-01-01T00:00:00.000Z'),
    consecutiveFailures: 1,
    lastError: 'rate limited',
  };

  const firstCheck = await runListenerHealthCheckJob({
    fetchScanState: async () => stalledScanState,
    alertOnStall: async (alertMessage) => alertMessages.push(alertMessage),
    now: stallNow,
    alertState,
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    realertIntervalMs: REALERT_INTERVAL_MS,
    processStartedAt: PROCESS_STARTED_AT,
  });
  assert.equal(firstCheck.stalled, true);
  assert.equal(firstCheck.alertSent, true);
  assert.equal(alertMessages.length, 1);

  const repeatedCheck = await runListenerHealthCheckJob({
    fetchScanState: async () => stalledScanState,
    alertOnStall: async (alertMessage) => alertMessages.push(alertMessage),
    now: new Date('2026-01-01T00:11:00.000Z'),
    alertState,
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    realertIntervalMs: REALERT_INTERVAL_MS,
    processStartedAt: PROCESS_STARTED_AT,
  });
  assert.equal(repeatedCheck.alertSent, false);
  assert.equal(alertMessages.length, 1);

  const afterRealertIntervalCheck = await runListenerHealthCheckJob({
    fetchScanState: async () => stalledScanState,
    alertOnStall: async (alertMessage) => alertMessages.push(alertMessage),
    now: new Date('2026-01-01T00:41:00.000Z'),
    alertState,
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    realertIntervalMs: REALERT_INTERVAL_MS,
    processStartedAt: PROCESS_STARTED_AT,
  });
  assert.equal(afterRealertIntervalCheck.alertSent, true);
  assert.equal(alertMessages.length, 2);

  const recoveredCheck = await runListenerHealthCheckJob({
    fetchScanState: async () => ({
      lastScannedAt: new Date('2026-01-01T00:42:00.000Z'),
      consecutiveFailures: 0,
      lastError: null,
    }),
    alertOnStall: async (alertMessage) => alertMessages.push(alertMessage),
    now: new Date('2026-01-01T00:42:30.000Z'),
    alertState,
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    realertIntervalMs: REALERT_INTERVAL_MS,
    processStartedAt: PROCESS_STARTED_AT,
  });
  assert.equal(recoveredCheck.healthy, true);
  assert.equal(alertState.lastAlertedAtMs, null);
  assert.equal(alertState.lastAlertedReason, null);

  const secondStallCheck = await runListenerHealthCheckJob({
    fetchScanState: async () => stalledScanState,
    alertOnStall: async (alertMessage) => alertMessages.push(alertMessage),
    now: new Date('2026-01-01T00:50:00.000Z'),
    alertState,
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    realertIntervalMs: REALERT_INTERVAL_MS,
    processStartedAt: PROCESS_STARTED_AT,
  });
  assert.equal(secondStallCheck.alertSent, true);
  assert.equal(alertMessages.length, 3);
});

test('a failed health query is reported instead of crashing the job', async () => {
  const alertMessages = [];
  const healthCheckResult = await runListenerHealthCheckJob({
    fetchScanState: async () => {
      throw new Error('database unavailable');
    },
    alertOnStall: async (alertMessage) => alertMessages.push(alertMessage),
    now: new Date('2026-01-01T00:10:00.000Z'),
    alertState: buildAlertState(),
    stallThresholdMs: STALL_THRESHOLD_MS,
    consecutiveFailureLimit: FAILURE_LIMIT,
    realertIntervalMs: REALERT_INTERVAL_MS,
    processStartedAt: PROCESS_STARTED_AT,
  });

  assert.equal(healthCheckResult.checked, false);
  assert.equal(healthCheckResult.reason, USDT_LISTENER_HEALTH_CHECK_FAILED);
  assert.equal(healthCheckResult.alertSent, true);
  assert.match(alertMessages[0], /database unavailable/);
});
