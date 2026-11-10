import {
  fetchMostRecentReconciliationRun,
  runReconciliationRun,
  RECONCILIATION_STATUS_FAILED,
} from '../services/reconciliationService.js';
import { sendTelegramAlertMessage } from '../services/telegramAlertService.js';

export const RECONCILIATION_SKIPPED_RECENT_RUN = 'RECONCILIATION_SKIPPED_RECENT_RUN';
export const DEFAULT_MINIMUM_HOURS_BETWEEN_RECONCILIATION_RUNS = 23;

// The serverless scheduler runs every minute. Checking "has a reconciliation
// already happened recently?" inside the job, after the advisory lock, keeps a
// once-a-day audit at one run per day even when the daily Vercel cron and an
// external scheduler both fire around the same time.
export async function runReconciliationJob({
  alertOnMismatch = sendTelegramAlertMessage,
  provider,
  startedAt,
  fetchMostRecentRun = fetchMostRecentReconciliationRun,
  runReconciliation = runReconciliationRun,
  minimumHoursBetweenRuns = DEFAULT_MINIMUM_HOURS_BETWEEN_RECONCILIATION_RUNS,
  now = new Date(),
} = {}) {
  const mostRecentRun = await fetchMostRecentRun();
  if (mostRecentRun?.started_at) {
    const hoursSinceLastRun =
      (now.getTime() - new Date(mostRecentRun.started_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastRun < minimumHoursBetweenRuns) {
      return {
        skipped: true,
        reason: RECONCILIATION_SKIPPED_RECENT_RUN,
        hoursSinceLastRun,
      };
    }
  }

  const runStartedAt = startedAt ?? now;
  const reconciliationResult = await runReconciliation({
    provider,
    startedAt: runStartedAt,
  });

  if (reconciliationResult.status === RECONCILIATION_STATUS_FAILED) {
    const failureMessage = `Reconciliation run failed: ${reconciliationResult.failureMessage}`;
    console.error(failureMessage);
    await alertOnMismatch(failureMessage).catch(() => {});
    return reconciliationResult;
  }

  if (!reconciliationResult.balanced) {
    const mismatchMessage = [
      'Reconciliation mismatch found:',
      `confirmed deposits: ${reconciliationResult.confirmedDepositsUsdt} USDT`,
      `in-flight deposits: ${reconciliationResult.inFlightDepositsUsdt} USDT`,
      `settled deposits: ${reconciliationResult.settledDepositsUsdt} USDT`,
      `treasury ledger: ${reconciliationResult.treasuryLedgerUsdt} USDT`,
      `on-chain treasury: ${reconciliationResult.onChainTreasuryUsdt} USDT`,
    ].join('\n');
    console.error(mismatchMessage);
    await alertOnMismatch(mismatchMessage).catch(() => {});
  }

  return reconciliationResult;
}