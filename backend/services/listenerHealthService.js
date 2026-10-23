export const USDT_LISTENER_HEALTHY = 'USDT_LISTENER_HEALTHY';
export const USDT_LISTENER_NEVER_SCANNED = 'USDT_LISTENER_NEVER_SCANNED';
export const USDT_LISTENER_SCAN_OVERDUE = 'USDT_LISTENER_SCAN_OVERDUE';
export const USDT_LISTENER_REPEATED_SCAN_FAILURES = 'USDT_LISTENER_REPEATED_SCAN_FAILURES';

export const DEFAULT_USDT_LISTENER_STALL_POLL_INTERVALS = 12;
export const DEFAULT_USDT_LISTENER_CONSECUTIVE_FAILURE_LIMIT = 5;
export const DEFAULT_USDT_LISTENER_STALL_REALERT_MS = 30 * 60 * 1000;

// A listener that stops scanning is the worst failure this product can have:
// money arrives on a deposit address and the booking is never confirmed. The
// scan cursor already records when it last advanced and how many failures it
// has seen, so health is decided from that durable state rather than from the
// job's own memory (which a restart would erase).
const listenerHealthServiceStartedAt = new Date();

function parsePositiveNumberConfiguration(variableName, configuredValue, defaultValue) {
  const rawValue = configuredValue ?? defaultValue;
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} must be a positive number, received "${rawValue}"`);
  }
  return parsedValue;
}

export function resolveUsdtListenerStallThresholdMs() {
  const pollIntervalMs = parsePositiveNumberConfiguration(
    'MONITOR_POLL_INTERVAL_MS',
    process.env.MONITOR_POLL_INTERVAL_MS,
    5000
  );
  const pollIntervalCount = parsePositiveNumberConfiguration(
    'MONITOR_STALL_ALERT_POLL_INTERVALS',
    process.env.MONITOR_STALL_ALERT_POLL_INTERVALS,
    DEFAULT_USDT_LISTENER_STALL_POLL_INTERVALS
  );
  return pollIntervalMs * pollIntervalCount;
}

export function resolveUsdtListenerConsecutiveFailureLimit() {
  return parsePositiveNumberConfiguration(
    'MONITOR_STALL_ALERT_FAILURE_LIMIT',
    process.env.MONITOR_STALL_ALERT_FAILURE_LIMIT,
    DEFAULT_USDT_LISTENER_CONSECUTIVE_FAILURE_LIMIT
  );
}

export function resolveUsdtListenerStallRealertMs() {
  return parsePositiveNumberConfiguration(
    'MONITOR_STALL_ALERT_REALERT_MS',
    process.env.MONITOR_STALL_ALERT_REALERT_MS,
    DEFAULT_USDT_LISTENER_STALL_REALERT_MS
  );
}

/**
 * Decides whether the payment listener is still doing its job.
 *
 * `processStartedAt` is the fallback reference when the listener has never
 * completed a scan, so a process that hangs on its very first RPC call is
 * reported instead of looking like normal startup forever.
 */
export function evaluateUsdtListenerHealth({
  scanState,
  now = new Date(),
  stallThresholdMs = resolveUsdtListenerStallThresholdMs(),
  consecutiveFailureLimit = resolveUsdtListenerConsecutiveFailureLimit(),
  processStartedAt = listenerHealthServiceStartedAt,
}) {
  const consecutiveFailures = Number(scanState?.consecutiveFailures ?? 0);
  const lastScannedAt = scanState?.lastScannedAt ? new Date(scanState.lastScannedAt) : null;
  const lastError = scanState?.lastError ?? null;

  const nowMs = new Date(now).getTime();
  const referenceMoment = lastScannedAt ?? new Date(processStartedAt);
  const elapsedSinceReferenceMs = Math.max(0, nowMs - referenceMoment.getTime());
  const secondsSinceLastScan = lastScannedAt
    ? Math.floor((nowMs - lastScannedAt.getTime()) / 1000)
    : null;

  const healthSnapshot = {
    consecutiveFailures,
    lastScannedAt,
    lastError,
    secondsSinceLastScan,
    secondsSinceReference: Math.floor(elapsedSinceReferenceMs / 1000),
    stallThresholdMs,
    consecutiveFailureLimit,
  };

  if (consecutiveFailures >= consecutiveFailureLimit) {
    return {
      ...healthSnapshot,
      healthy: false,
      stalled: true,
      reason: USDT_LISTENER_REPEATED_SCAN_FAILURES,
    };
  }

  if (elapsedSinceReferenceMs > stallThresholdMs) {
    return {
      ...healthSnapshot,
      healthy: false,
      stalled: true,
      reason: lastScannedAt
        ? USDT_LISTENER_SCAN_OVERDUE
        : USDT_LISTENER_NEVER_SCANNED,
    };
  }

  return {
    ...healthSnapshot,
    healthy: true,
    stalled: false,
    reason: USDT_LISTENER_HEALTHY,
  };
}

export function buildUsdtListenerStallAlertMessage(listenerHealth) {
  const thresholdSeconds = Math.round(listenerHealth.stallThresholdMs / 1000);
  const lastErrorSuffix = listenerHealth.lastError
    ? ` Last recorded error: ${listenerHealth.lastError}`
    : '';

  switch (listenerHealth.reason) {
    case USDT_LISTENER_REPEATED_SCAN_FAILURES:
      return (
        `USDT payment listener failed ${listenerHealth.consecutiveFailures} consecutive scan(s) `
        + `(limit ${listenerHealth.consecutiveFailureLimit}).${lastErrorSuffix}`
      );
    case USDT_LISTENER_SCAN_OVERDUE:
      return (
        `USDT payment listener has not completed a scan for ${listenerHealth.secondsSinceLastScan}s `
        + `(threshold ${thresholdSeconds}s).${lastErrorSuffix}`
      );
    case USDT_LISTENER_NEVER_SCANNED:
      return (
        `USDT payment listener has not completed a scan since the process started `
        + `(${listenerHealth.secondsSinceReference}s ago, threshold ${thresholdSeconds}s).${lastErrorSuffix}`
      );
    default:
      return 'USDT payment listener health check reported a stall.';
  }
}
