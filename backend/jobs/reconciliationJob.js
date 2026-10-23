import {
  runReconciliationRun,
  RECONCILIATION_STATUS_FAILED,
} from '../services/reconciliationService.js';
import { sendTelegramAlertMessage } from '../services/telegramAlertService.js';

export async function runReconciliationJob({
  alertOnMismatch = sendTelegramAlertMessage,
  provider,
  startedAt,
} = {}) {
  const reconciliationResult = await runReconciliationRun({ provider, startedAt });

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