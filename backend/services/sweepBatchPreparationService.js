import { randomUUID } from 'node:crypto';

import { createUsdtProvider, getTreasuryWalletAddress, getUsdtContractAddress } from './usdtPaymentService.js';

import {
  SWEEP_PREPARATION_ALREADY_HANDLED,
  SWEEP_PREPARATION_NOT_COLLECTABLE,
  buildUnsignedSweepAttempts,
  fetchPaidOrdersEligibleForSweep,
  getSweepMinimumAgeHours,
  markUnfinishedSweepRecordAsFailed,
  prepareSweepRecordWithFundedGas,
} from './sweepService.js';

import { sendTelegramAlertMessage } from './telegramAlertService.js';

export const SWEEP_BATCH_ITEM_PREPARED = 'PREPARED_FOR_OFFLINE_SIGNING';
export const SWEEP_BATCH_ITEM_ALREADY_HANDLED = 'ALREADY_HANDLED';
export const SWEEP_BATCH_ITEM_NOT_COLLECTABLE = 'NOT_COLLECTABLE';
export const SWEEP_BATCH_ITEM_FAILED = 'FAILED';

/**
 * Prepares every collectable order for signing on the air-gapped machine.
 *
 * Nothing is broadcast here. The output contains one unsigned transaction per
 * gas-price attempt (same nonce), so the offline machine can sign the whole
 * retry ladder in one visit and the online host can still bump the gas price
 * without a second signing round.
 *
 * Funding already happened on this host because the gas wallet is a separate
 * hot key; the deposit seed is never used.
 */
export async function prepareSweepBatchForOfflineSigning({
  provider = createUsdtProvider(),
  minimumAgeHours = getSweepMinimumAgeHours(),
  fetchEligibleOrders = fetchPaidOrdersEligibleForSweep,
  alertOnSweepFailure = sendTelegramAlertMessage,
  triggeredBy = 'offline-batch',
  ...sweepDependencies
} = {}) {
  const eligiblePaidOrders = await fetchEligibleOrders({ minimumAgeHours });

  const items = [];
  const results = [];
  let cycleSpentBnbWei = 0n;
  let chainId = null;

  for (const orderRow of eligiblePaidOrders) {
    try {
      const preparation = await prepareSweepRecordWithFundedGas(orderRow, {
        ...sweepDependencies,
        provider,
        triggeredBy,
        cycleSpentBnbWei,
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
      items.push({
        orderId: orderRow.order_id,
        sweepId: preparation.sweepRecord.id,
        depositAddress: preparation.depositAddress,
        derivationIndex: preparation.derivationIndex,
        amountWei: preparation.usdtBalanceWei.toString(),
        chainId: unsignedAttempts.chainId,
        nonce: unsignedAttempts.nonce,
        gasLimit: preparation.gasLimit,
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
    },
    items,
    results,
  };
}
