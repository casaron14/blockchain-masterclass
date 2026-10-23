import pool from '../config/db.js';
import { runPaymentMonitorJob } from '../jobs/paymentMonitorJob.js';
import { fetchTransferScanState } from './monitorService.js';
import { fetchPaymentRecordById } from './paymentService.js';
import { logWarning } from '../utils/applicationLogger.js';

// Serverless deployments (Vercel) cannot run the five-second in-process
// listener. The attendee's own status poll therefore triggers the same
// listener tick on demand. Three guards keep that from becoming an RPC
// amplifier:
//   1. a Postgres advisory lock, so only one invocation scans at a time;
//   2. a freshness window, so concurrent polls reuse the scan that just ran;
//   3. a failure backoff for the current warm instance, so a dead RPC is not
//      retried every four seconds by the same visitor.
const ON_DEMAND_SCAN_MIN_INTERVAL_MS = Number(
  process.env.ON_DEMAND_SCAN_MIN_INTERVAL_MS || 5000
);
const ON_DEMAND_SCAN_FAILURE_BACKOFF_MS = Number(
  process.env.ON_DEMAND_SCAN_FAILURE_BACKOFF_MS || 30000
);
const ON_DEMAND_SCAN_ADVISORY_LOCK_KEY = 764001;

let lastOnDemandScanFailureAtMs = null;

function hasRecentScanWithinInterval(scanState) {
  if (!scanState.lastScannedAt) {
    return false;
  }
  return Date.now() - scanState.lastScannedAt.getTime() < ON_DEMAND_SCAN_MIN_INTERVAL_MS;
}

function isInsideFailureBackoffWindow() {
  return (
    lastOnDemandScanFailureAtMs !== null &&
    Date.now() - lastOnDemandScanFailureAtMs < ON_DEMAND_SCAN_FAILURE_BACKOFF_MS
  );
}

export async function refreshUsdtPaymentObservationOnDemand(paymentId) {
  const paymentRecordBeforeScan = await fetchPaymentRecordById(paymentId);
  if (!paymentRecordBeforeScan) {
    return { paymentRecord: null, didRunScan: false, reason: 'PAYMENT_NOT_FOUND' };
  }

  if (paymentRecordBeforeScan.status === 'confirmed') {
    return {
      paymentRecord: paymentRecordBeforeScan,
      didRunScan: false,
      reason: 'ALREADY_CONFIRMED',
    };
  }

  if (isInsideFailureBackoffWindow()) {
    return {
      paymentRecord: paymentRecordBeforeScan,
      didRunScan: false,
      reason: 'SCAN_BACKOFF',
    };
  }

  const scanState = await fetchTransferScanState();
  if (hasRecentScanWithinInterval(scanState)) {
    return {
      paymentRecord: paymentRecordBeforeScan,
      didRunScan: false,
      reason: 'SCAN_RECENT',
    };
  }

  const lockClient = await pool.connect();
  let didAcquireLock = false;
  try {
    const lockResult = await lockClient.query(
      'SELECT pg_try_advisory_lock($1) AS did_acquire',
      [ON_DEMAND_SCAN_ADVISORY_LOCK_KEY]
    );
    didAcquireLock = lockResult.rows[0].did_acquire === true;

    if (!didAcquireLock) {
      return {
        paymentRecord: paymentRecordBeforeScan,
        didRunScan: false,
        reason: 'SCAN_IN_PROGRESS',
      };
    }

    // Re-read after taking the lock: another invocation may have scanned while
    // this one was waiting for the connection.
    if (hasRecentScanWithinInterval(await fetchTransferScanState())) {
      return {
        paymentRecord: paymentRecordBeforeScan,
        didRunScan: false,
        reason: 'SCAN_RECENT',
      };
    }

    // runPaymentMonitorJob reuses the process-wide RPC pool and swallows RPC
    // errors, reporting them as `failed` instead of throwing.
    const monitorOutcome = await runPaymentMonitorJob();

    if (monitorOutcome?.failed) {
      lastOnDemandScanFailureAtMs = Date.now();
      logWarning('on_demand_usdt_scan_failed', {
        paymentId,
        errorMessage: monitorOutcome.reason,
      });
      return {
        paymentRecord: paymentRecordBeforeScan,
        didRunScan: false,
        reason: 'SCAN_FAILED',
      };
    }

    lastOnDemandScanFailureAtMs = null;

    const paymentRecordAfterScan = await fetchPaymentRecordById(paymentId);
    return {
      paymentRecord: paymentRecordAfterScan ?? paymentRecordBeforeScan,
      didRunScan: true,
      reason: 'SCAN_COMPLETED',
    };
  } finally {
    if (didAcquireLock) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [
        ON_DEMAND_SCAN_ADVISORY_LOCK_KEY,
      ]);
    }
    lockClient.release();
  }
}
