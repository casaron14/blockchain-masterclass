import { fetchGasWalletBnbBalance, createGasWalletSigner } from '../services/gasWalletService.js';
import { sendTelegramAlertMessage } from '../services/telegramAlertService.js';

export function resolveGasWalletLowBalanceThresholdEth() {
  return Number(process.env.GAS_WALLET_LOW_BALANCE_ALERT_THRESHOLD_BNB || 0.1);
}

export async function runGasWalletMonitorJob({
  fetchGasBalance = fetchGasWalletBnbBalance,
  alertOnLowBalance = sendTelegramAlertMessage,
  provider,
} = {}) {
  const lowBalanceThresholdEth = resolveGasWalletLowBalanceThresholdEth();

  let gasWalletBnbBalanceEth;
  try {
    const gasWalletSigner = createGasWalletSigner(provider);
    const balanceWei = await fetchGasBalance(gasWalletSigner);
    gasWalletBnbBalanceEth = Number(balanceWei) / 10 ** 18;
  } catch (error) {
    await alertOnLowBalance(`Gas wallet balance check failed: ${error.message}`).catch(() => {});
    return { checked: false, reason: 'GAS_BALANCE_CHECK_FAILED' };
  }

  if (gasWalletBnbBalanceEth < lowBalanceThresholdEth) {
    const lowBalanceMessage =
      `Gas wallet low on BNB: ${gasWalletBnbBalanceEth} BNB (threshold ${lowBalanceThresholdEth})`;
    console.error(lowBalanceMessage);
    await alertOnLowBalance(lowBalanceMessage).catch(() => {});
    return { checked: true, belowThreshold: true, gasWalletBnbBalanceEth };
  }

  return { checked: true, belowThreshold: false, gasWalletBnbBalanceEth };
}