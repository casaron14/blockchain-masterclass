import { fetchTransferScanState } from '../services/monitorService.js';

import {
  buildUsdtListenerStallAlertMessage,
  evaluateUsdtListenerHealth,
  resolveUsdtListenerConsecutiveFailureLimit,
  resolveUsdtListenerStallRealertMs,
  resolveUsdtListenerStallThresholdMs,
} from '../services/listenerHealthService.js';

import { sendTelegramAlertMessage } from '../services/telegramAlertService.js';

export const USDT_LISTENER_HEALTH_CHECK_FAILED = 'LISTENER_HEALTH_CHECK_FAILED';

// Sending the same alert on every check would train the operator to ignore it.
// The state is process-local on purpose: a restart re-reads the durable scan
// cursor and may legitimately need to raise the alarm again.
export const defaultListenerStallAlertState = {
  lastAlertedAtMs: null,
  lastAlertedReason: null,
};

export function resetListenerStallAlertStateForTesting() {
  defaultListenerStallAlertState.lastAlertedAtMs = null;
  defaultListenerStallAlertState.lastAlertedReason = null;
}

function shouldSendListenerStallAlert({
  alertState,
  alertReason,
  nowMs,
  realertIntervalMs,
}) {
  if (alertState.lastAlertedReason !== alertReason) {
    return true;
  }
  if (alertState.lastAlertedAtMs === null) {
    return true;
  }
  return nowMs - alertState.lastAlertedAtMs >= realertIntervalMs;
}

async function sendListenerStallAlertOnBestEffort(alertOnStall, alertMessage) {
  try {
    await alertOnStall(alertMessage);
    return true;
  } catch (alertError) {
    console.error('USDT listener stall alert failed', alertError.message);
    return false;
  }
}

export async function runListenerHealthCheckJob({
  fetchScanState = fetchTransferScanState,
  alertOnStall = sendTelegramAlertMessage,
  now = new Date(),
  alertState = defaultListenerStallAlertState,
  stallThresholdMs = resolveUsdtListenerStallThresholdMs(),
  consecutiveFailureLimit = resolveUsdtListenerConsecutiveFailureLimit(),
  realertIntervalMs = resolveUsdtListenerStallRealertMs(),
  processStartedAt,
} = {}) {
  const nowMs = new Date(now).getTime();

  let listenerHealth;
  try {
    const scanState = await fetchScanState();
    listenerHealth = evaluateUsdtListenerHealth({
      scanState,
      now,
      stallThresholdMs,
      consecutiveFailureLimit,
      ...(processStartedAt === undefined ? {} : { processStartedAt }),
    });
  } catch (healthCheckError) {
    const alertMessage = `USDT payment listener health check failed: ${healthCheckError.message}`;
    let alertSent = false;
    if (shouldSendListenerStallAlert({
      alertState,
      alertReason: USDT_LISTENER_HEALTH_CHECK_FAILED,
      nowMs,
      realertIntervalMs,
    })) {
      alertSent = await sendListenerStallAlertOnBestEffort(alertOnStall, alertMessage);
      alertState.lastAlertedAtMs = nowMs;
      alertState.lastAlertedReason = USDT_LISTENER_HEALTH_CHECK_FAILED;
    }
    return {
      checked: false,
      healthy: false,
      stalled: true,
      reason: USDT_LISTENER_HEALTH_CHECK_FAILED,
      message: alertMessage,
      alertSent,
    };
  }

  if (!listenerHealth.stalled) {
    alertState.lastAlertedAtMs = null;
    alertState.lastAlertedReason = null;
    return { checked: true, ...listenerHealth, alertSent: false };
  }

  const alertMessage = buildUsdtListenerStallAlertMessage(listenerHealth);
  let alertSent = false;
  if (shouldSendListenerStallAlert({
    alertState,
    alertReason: listenerHealth.reason,
    nowMs,
    realertIntervalMs,
  })) {
    alertSent = await sendListenerStallAlertOnBestEffort(alertOnStall, alertMessage);
    alertState.lastAlertedAtMs = nowMs;
    alertState.lastAlertedReason = listenerHealth.reason;
  }

  return { checked: true, ...listenerHealth, message: alertMessage, alertSent };
}
