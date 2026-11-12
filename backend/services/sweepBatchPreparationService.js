import { randomUUID } from 'node:crypto';

import { createUsdtProvider, getTreasuryWalletAddress, getUsdtContractAddress } from './usdtPaymentService.js';

import {
  SWEEP_PREPARATION_ALREADY_HANDLED,
  SWEEP_PREPARATION_NOT_COLLECTABLE,
  buildUnsignedSweepAttempts,
  fetchAbandonedOrdersEligibleForRecoverySweep,
  fetchPaidOrdersEligibleForSweep,
  getSweepMinimumAgeHours,
  markUnfinishedSweepRecordAsFailed,
  prepareSweepRecordWithFundedGas,
} from './sweepService.js';

import { resolveGasWalletAddress } from './gasWalletService.js';

import { sendTelegramAlertMessage } from './telegramAlertService.js';

export const SWEEP_BATCH_ITEM_PREPARED = 'PREPARED_FOR_OFFLINE_SIGNING';
export const SWEEP_BATCH_ITEM_ALREADY_HANDLED = 'ALREADY_HANDLED';
export const SWEEP_BATCH_ITEM_NOT_COLLECTABLE = 'NOT_COLLECTABLE';
export const SWEEP_BATCH_ITEM_FAILED = 'FAILED';

/**
 * Prepares every collectable order for signing on the air-gapped machine.
 *
 * Nothing is broadcast here and nothing is signed here. Each item carries two
 * unsigned transactions: the BNB funding transfer from the gas wallet, and the
 * USDT transfer to the treasury (one per gas-price attempt, same nonce, so the
 * online host can bump the gas price without a second signing round).
 *
 * Gas funding used to happen on this host with a hot gas wallet key. It is part
 * of the batch now, because the offline machine holds the only gas wallet key.
 */
export async function prepareSweepBatchForOfflineSigning({
  provider = createUsdtProvider(),
  minimumAgeHours = getSweepMinimumAgeHours(),
  fetchEligibleOrders = fetchPaidOrdersEligibleForSweep,
  fetchAbandonedEligibleOrders = fetchAbandonedOrdersEligibleForRecoverySweep,
  alertOnSweepFailure = sendTelegramAlertMessage,
  triggeredBy = 'offline-batch',
  ...sweepDependencies
} = {}) {
  const eligiblePaidOrders = await fetchEligibleOrders({ minimumAgeHours });
  const eligibleAbandonedOrders = await fetchAbandonedEligibleOrders({ minimumAgeHours });

  const orderCandidatesByOrderId = new Map();
  for (const orderRow of [...eligiblePaidOrders, ...eligibleAbandonedOrders]) {
    if (!orderCandidatesByOrderId.has(orderRow.order_id)) {
      orderCandidatesByOrderId.set(orderRow.order_id, orderRow);
    }
  }

  const items = [];
  const results = [];
  let cycleSpentBnbWei = 0n;
  let chainId = null;

  // Every funding transaction in one batch is sent from the same gas wallet, so
  // the nonces have to be allocated here, one per item, instead of reading the
  // chain once per order and handing out the same nonce twice.
  // shortcut: gas-wallet nonces assume the batch is submitted in prepared order;
  // if an early item fails, later funding transactions wait, so re-prepare.
  const gasWalletAddress = resolveGasWalletAddress();
  let gasWalletFundingNonce = await provider.getTransactionCount(
    gasWalletAddress,
    'pending'
  );

  for (const orderRow of orderCandidatesByOrderId.values()) {
    try {
      const preparation = await prepareSweepRecordWithFundedGas(orderRow, {
        ...sweepDependencies,
        provider,
        triggeredBy,
        cycleSpentBnbWei,
        unsignedGasFundingOnly: true,
        gasWalletFundingNonce,
      });

      if (preparation.preparationStatus === SWEEP_PREPARATION_ALREADY_HANDLED) {
        results.push({
          orderId: orderRow.order_id,
          status: SWEEP_BATCH_ITEM_ALREADY_HANDLED,
          reason: preparation.sweepResult.reason ?? null,
        });
        continue;
      }

      if (preparation.preparationStatus === SWEEP_PREPARATION_NOT_COLLECTABLE) {
        results.push({
          orderId: orderRow.order_id,
          status: SWEEP_BATCH_ITEM_NOT_COLLECTABLE,
          reason: preparation.reason,
        });
        continue;
      }

      const unsignedAttempts = await buildUnsignedSweepAttempts({
        provider,
        depositAddress: preparation.depositAddress,
        gasLimit: preparation.gasLimit,
        usdtBalanceWei: preparation.usdtBalanceWei,
        baseGasPriceWei: preparation.baseGasPriceWei,
        maxRetries: preparation.maxRetries,
        gasPriceBumpPercent: preparation.gasPriceBumpPercent,
      });

      chainId = unsignedAttempts.chainId ?? chainId;
      cycleSpentBnbWei += preparation.bnbFundedWei;
      if (preparation.unsignedGasFunding) {
        gasWalletFundingNonce += 1;
      }
      items.push({
        orderId: orderRow.order_id,
        sweepId: preparation.sweepRecord.id,
        depositAddress: preparation.depositAddress,
        derivationIndex: preparation.derivationIndex,
        amountWei: preparation.usdtBalanceWei.toString(),
        chainId: unsignedAttempts.chainId,
        nonce: unsignedAttempts.nonce,
        gasLimit: preparation.gasLimit,
        gasFunding: preparation.unsignedGasFunding,
        attempts: unsignedAttempts.attempts,
      });
      results.push({
        orderId: orderRow.order_id,
        status: SWEEP_BATCH_ITEM_PREPARED,
        sweepId: preparation.sweepRecord.id,
      });
    } catch (sweepError) {
      await markUnfinishedSweepRecordAsFailed(orderRow.order_id, sweepError.message);
      const alertMessage = (
        `Sweep preparation failed for order ${orderRow.order_id} `
        + `(deposit ${orderRow.deposit_address}): ${sweepError.message}`
      );
      await alertOnSweepFailure(alertMessage).catch(() => {});
      results.push({
        orderId: orderRow.order_id,
        status: SWEEP_BATCH_ITEM_FAILED,
        message: sweepError.message,
      });
    }
  }

  return {
    batchId: randomUUID(),
    createdAt: new Date().toISOString(),
    network: {
      chainId,
      usdtContractAddress: getUsdtContractAddress(),
      treasuryAddress: getTreasuryWalletAddress(),
      gasWalletAddress,
    },
    items,
    results,
  };
}
