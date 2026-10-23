import { ethers } from 'ethers';
import pool from '../config/db.js';

import {
  createUsdtProvider,
  getUsdtContractAddress,
  getTreasuryWalletAddress,
  DEFAULT_USDT_DECIMALS,
  USDT_BEP20_ABI,
} from './usdtPaymentService.js';

import {
  createGasWalletSigner,
  fetchUsdtBalanceAtDepositAddress,
  fetchBnbBalanceAtDepositAddress,
  fetchCurrentBscGasPrice,
  computeSweepGasFeeWei,
  transferBnbFromGasWalletToDepositAddress,
  getSweepMinThresholdUsdt,
  getSweepGasPriceBumpPercent,
  getSweepMaxRetries,
} from './gasWalletService.js';

import { signSerializedTransactionWithDerivedKey } from './signingService.js';

import {
  buildGasSponsorshipRefusalMessage,
  evaluateGasSponsorshipDecision,
  fetchSponsoredBnbSpentInRollingWindow,
  GasSponsorshipLimitExceededError,
  resolveGasSponsorshipLimits,
} from './gasSponsorshipPolicyService.js';

import { fetchChainSettlementFrontier } from './blockFinalityService.js';

import { sendTelegramAlertMessage } from './telegramAlertService.js';

export const SWEEP_RETRY_FAILURE_LIMIT = 3;
export const DEFAULT_SWEEP_MINIMUM_AGE_HOURS = 24;

export function getSweepMinimumAgeHours() {
  return Number(process.env.SWEEP_MINIMUM_AGE_HOURS || DEFAULT_SWEEP_MINIMUM_AGE_HOURS);
}

export function getUsdtTransferInterface() {
  return new ethers.Interface(USDT_BEP20_ABI);
}

export function convertUsdtWeiToUsdtAmount(usdtAmountWei) {
  return Number(ethers.formatUnits(usdtAmountWei, DEFAULT_USDT_DECIMALS));
}

export function isDepositBalanceAboveSweepThreshold(usdtBalanceWei) {
  return convertUsdtWeiToUsdtAmount(usdtBalanceWei) > getSweepMinThresholdUsdt();
}

/**
 * Returns the age in hours of a confirmed payment, or null when the payment
 * has no confirmation timestamp at all (an order that never settled).
 */
export function computeHoursSincePaymentConfirmation(confirmedAt, now = new Date()) {
  if (!confirmedAt) {
    return null;
  }
  const confirmationMoment = new Date(confirmedAt);
  if (Number.isNaN(confirmationMoment.getTime())) {
    return null;
  }
  return (now.getTime() - confirmationMoment.getTime()) / (1000 * 60 * 60);
}

export function isConfirmedPaymentSettledPastMinimumAge(
  confirmedAt,
  now = new Date(),
  minimumAgeHours = getSweepMinimumAgeHours()
) {
  const confirmationAgeHours = computeHoursSincePaymentConfirmation(confirmedAt, now);
  return confirmationAgeHours !== null && confirmationAgeHours >= minimumAgeHours;
}

/**
 * Decides whether a deposit address may be collected to the treasury.
 *
 * The threshold governs *premature* collection only: a deposit whose payment
 * has been confirmed and has been settled longer than the minimum age is always
 * collectable, otherwise a single 3.8 USDT ticket would never be swept at all
 * while the operator-configured threshold sits at 10 USDT. An amount that is
 * still below the expected ticket is left alone while the payer may still be
 * completing the transfer.
 */
export function evaluateDepositCollectionReadiness({
  balanceUsdt,
  expectedAmountUsdt,
  confirmedAt,
  now = new Date(),
  minimumAgeHours = getSweepMinimumAgeHours(),
}) {
  if (!(balanceUsdt > 0)) {
    return { collectable: false, reason: 'EMPTY_DEPOSIT_ADDRESS' };
  }

  const settledPastMinimumAge = isConfirmedPaymentSettledPastMinimumAge(
    confirmedAt,
    now,
    minimumAgeHours
  );
  const belowExpectedAmountAndStillSettling = expectedAmountUsdt > 0
    && balanceUsdt < expectedAmountUsdt
    && !settledPastMinimumAge;
  if (belowExpectedAmountAndStillSettling) {
    return { collectable: false, reason: 'BELOW_EXPECTED_AMOUNT' };
  }

  if (settledPastMinimumAge) {
    return { collectable: true, reason: 'CONFIRMED_AND_SETTLED' };
  }

  if (balanceUsdt > getSweepMinThresholdUsdt()) {
    return { collectable: true, reason: 'ABOVE_SWEEP_THRESHOLD' };
  }

  return { collectable: false, reason: 'BELOW_SWEEP_THRESHOLD' };
}

export function isDepositReadyForCollection({
  balanceUsdt,
  expectedAmountUsdt,
  confirmedAt,
  now = new Date(),
}) {
  return evaluateDepositCollectionReadiness({
    balanceUsdt,
    expectedAmountUsdt,
    confirmedAt,
    now,
  }).collectable;
}

/**
 * Paid orders whose payment has been settled for at least the minimum age,
 * oldest first, so the daily collection never moves a deposit that a
 * confirmation run still needs as evidence.
 */
export async function fetchPaidOrdersEligibleForSweep({
  minimumAgeHours = getSweepMinimumAgeHours(),
} = {}) {
  const result = await pool.query(
    `SELECT o.id AS order_id, o.customer_id, o.amount_usdt,
            o.booking_id, o.expires_at,
            da.address AS deposit_address, da.derivation_index,
            COALESCE(p.confirmed_at, observed.finality_confirmed_at) AS confirmed_at
       FROM orders o
       JOIN deposit_addresses da ON da.order_id = o.id AND da.is_active
       LEFT JOIN payments p
              ON p.booking_id = o.booking_id AND p.status = 'confirmed'
       LEFT JOIN LATERAL (
            SELECT MAX(COALESCE(deposit.finality_confirmed_at, deposit.matched_at))
                      AS finality_confirmed_at
              FROM deposits_observed deposit
             WHERE deposit.order_id = o.id
       ) observed ON TRUE
      WHERE o.status = 'paid'
        AND COALESCE(p.confirmed_at, observed.finality_confirmed_at)
              <= now() - make_interval(hours => $1)
      ORDER BY COALESCE(p.confirmed_at, observed.finality_confirmed_at) ASC`,
    [minimumAgeHours]
  );
  return result.rows.map((row) => ({
    ...row,
    order_id: Number(row.order_id),
    customer_id: Number(row.customer_id),
    booking_id: Number(row.booking_id),
    derivation_index: Number(row.derivation_index),
    amount_usdt: Number(row.amount_usdt),
  }));
}

export async function createPendingSweepRecord(
  orderId,
  depositAddress,
  amountWei,
  { triggeredBy = 'scheduled', treasuryAddress = null } = {}
) {
  const result = await pool.query(
    `INSERT INTO sweeps (order_id, address, amount, amount_wei, triggered_by, treasury_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      orderId,
      depositAddress,
      convertUsdtWeiToUsdtAmount(amountWei),
      amountWei.toString(),
      triggeredBy,
      treasuryAddress,
    ]
  );
  return result.rows[0];
}

export async function markSweepAsFunded(sweepId, bnbFundedWei) {
  const result = await pool.query(
    `UPDATE sweeps
        SET status = 'funded',
            bnb_funded = $1,
            bnb_funded_wei = $2
      WHERE id = $3
      RETURNING *`,
    [
      Number(ethers.formatEther(bnbFundedWei)),
      bnbFundedWei.toString(),
      sweepId,
    ]
  );
  return result.rows[0] ?? null;
}

export async function markSweepRecordAsFailed(sweepId, failureReason) {
  const result = await pool.query(
    `UPDATE sweeps
        SET status = 'failed', failure_reason = $1
      WHERE id = $2
      RETURNING *`,
    [failureReason, sweepId]
  );
  return result.rows[0] ?? null;
}

/**
 * Records the hash of a transaction that has been handed to the network.
 *
 * A broadcast is a one-way action: once the node accepts (or even silently
 * accepts) the transaction it can be mined, so the hash must be durable before
 * the process waits on it. Without this, a crash between broadcast and
 * confirmation leaves money in flight with no record of which transaction moved
 * it, and the next daily pass would send a second transfer.
 */
export async function markSweepTransactionAsBroadcast(sweepId, txHash, gasPriceWei = null) {
  const result = await pool.query(
    `UPDATE sweeps
        SET tx_hash = $1,
            gas_price_wei = COALESCE($2, gas_price_wei)
      WHERE id = $3
        AND status IN ('pending', 'funded')
      RETURNING *`,
    [txHash, gasPriceWei === null ? null : gasPriceWei.toString(), sweepId]
  );
  return result.rows[0] ?? null;
}

/**
 * Completes a sweep in one database transaction: the sweep row, the treasury
 * ledger entry and the order status all move together or not at all.
 *
 * Separate statements could be interrupted between them, which would leave a
 * sweep recorded as swept without a ledger row (or the reverse) and make the
 * collection impossible to reconcile. The ledger insert is keyed on the
 * transaction hash, so calling this twice for the same on-chain transfer cannot
 * create a second movement.
 */
export async function completeSweepRecordWithTreasuryMovement({
  sweepId,
  orderId,
  txHash,
  gasUsed = null,
  blockNumber = null,
  blockHash = null,
  gasPriceWei = null,
  amountUsdt,
  confirmedAt = new Date(),
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sweepUpdate = await client.query(
      `UPDATE sweeps
          SET status = 'swept',
              tx_hash = $1,
              gas_used = COALESCE($2, gas_used),
              block_number = COALESCE($3, block_number),
              block_hash = COALESCE($4, block_hash),
              gas_price_wei = COALESCE($5, gas_price_wei),
              confirmed_at = COALESCE(confirmed_at, $6),
              failure_reason = NULL
        WHERE id = $7
        RETURNING *`,
      [
        txHash,
        gasUsed,
        blockNumber,
        blockHash,
        gasPriceWei === null ? null : gasPriceWei.toString(),
        confirmedAt,
        sweepId,
      ]
    );
    if (!sweepUpdate.rows[0]) {
      throw new Error(`SWEEP_RECORD_NOT_FOUND:${sweepId}`);
    }

    const treasuryLedgerInsert = await client.query(
      `INSERT INTO treasury_ledger (order_id, sweep_id, tx_hash, amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING *`,
      [orderId, sweepId, txHash, amountUsdt]
    );

    const orderUpdate = await client.query(
      `UPDATE orders
          SET status = 'swept'
        WHERE id = $1
          AND status = 'paid'
        RETURNING *`,
      [orderId]
    );

    await client.query('COMMIT');

    return {
      sweepRecord: sweepUpdate.rows[0],
      treasuryLedgerRecord: treasuryLedgerInsert.rows[0] ?? null,
      orderMarkedSwept: orderUpdate.rowCount === 1,
    };
  } catch (completionError) {
    await client.query('ROLLBACK').catch(() => {});
    throw completionError;
  } finally {
    client.release();
  }
}

export async function fetchUnfinishedSweepRecordByOrderId(orderId) {
  const result = await pool.query(
    `SELECT * FROM sweeps
      WHERE order_id = $1
        AND status IN ('pending', 'funded')
      ORDER BY created_at DESC
      LIMIT 1`,
    [orderId]
  );
  return result.rows[0] ?? null;
}

export async function fetchSweepRecordByOrderId(orderId) {
  const result = await pool.query(
    'SELECT * FROM sweeps WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [orderId]
  );
  return result.rows[0] ?? null;
}

export async function fetchSweepRecordById(sweepId) {
  const result = await pool.query('SELECT * FROM sweeps WHERE id = $1', [sweepId]);
  return result.rows[0] ?? null;
}

/**
 * The newest sweeps row is the durable record of the last collection attempt,
 * so a restart cannot sweep a second time inside the same daily window.
 */
export async function fetchMostRecentSweepRecordTimestamp() {
  const result = await pool.query(
    'SELECT MAX(created_at) AS most_recent_sweep_created_at FROM sweeps'
  );
  const mostRecentSweepCreatedAt = result.rows[0].most_recent_sweep_created_at;
  return mostRecentSweepCreatedAt ? new Date(mostRecentSweepCreatedAt) : null;
}

/**
 * Marks completed sweeps as irreversible once their block is at or below the
 * same finalized head the payment listener trusts.
 *
 * A sweep row is written when the transaction is mined, which can be minutes
 * before BEP-126 finality. Until this runs, `is_finalized` stays false and an
 * evidence check that requires finality keeps treating the transfer as pending;
 * after it runs, a reorg can no longer invalidate the collection record.
 */
export async function finalizeSettledSweepRecords(settlementFrontier) {
  if (!settlementFrontier) {
    return 0;
  }
  const result = await pool.query(
    `UPDATE sweeps
        SET is_finalized = true
      WHERE status = 'swept'
        AND is_finalized = false
        AND block_number IS NOT NULL
        AND block_number <= $1
      RETURNING id`,
    [settlementFrontier.finalizedBlockNumber]
  );
  return result.rowCount;
}

/**
 * The finality pass of a sweep cycle. A failure to read the frontier must not
 * undo collections that already succeeded, so it is reported and left for the
 * next cycle instead of being thrown into the per-order error path.
 */
export async function finalizeSweepsAgainstSettlementFrontier({
  provider,
  fetchSettlementFrontier = fetchChainSettlementFrontier,
} = {}) {
  try {
    const settlementFrontier = await fetchSettlementFrontier(provider);
    const finalizedSweepCount = await finalizeSettledSweepRecords(settlementFrontier);
    return { finalizedSweepCount, settlementFrontier };
  } catch (finalityError) {
    console.error('Sweep finality update failed', finalityError.message);
    return { finalizedSweepCount: 0, error: finalityError.message };
  }
}

async function createSweepGasWalletSigner(provider, dependencies) {
  if (dependencies.gasWalletSigner) {
    return dependencies.gasWalletSigner;
  }
  return createGasWalletSigner(provider);
}

async function resolveSweepChainId(provider) {
  if (provider && typeof provider.getNetwork === 'function') {
    const network = await provider.getNetwork();
    return BigInt(network.chainId);
  }
  if (provider && provider.network) {
    return BigInt(provider.network.chainId);
  }
  return 31337n;
}

export async function buildUnsignedUsdtTransfer({ depositAddress, nonce, gasPriceWei, gasLimit, usdtBalanceWei, provider }) {
  const usdtContract = new ethers.Contract(getUsdtContractAddress(), USDT_BEP20_ABI, provider);
  const chainId = await resolveSweepChainId(provider);
  return {
    chainId,
    nonce,
    gasPrice: gasPriceWei,
    gasLimit,
    to: getUsdtContractAddress(),
    value: 0n,
    data: usdtContract.interface.encodeFunctionData('transfer', [
      getTreasuryWalletAddress(),
      usdtBalanceWei,
    ]),
  };
}

/**
 * Builds one unsigned USDT transfer per gas-price attempt, all sharing the same
 * nonce. The offline signer signs every attempt, so a retry on the online host
 * is a same-nonce replacement that never needs a second trip to the air-gapped
 * machine and can never move the balance twice.
 */
export async function buildUnsignedSweepAttempts({
  provider,
  depositAddress,
  gasLimit,
  usdtBalanceWei,
  baseGasPriceWei,
  maxRetries = getSweepMaxRetries(),
  gasPriceBumpPercent = getSweepGasPriceBumpPercent(),
  fetchTransactionCount = (address) => provider.getTransactionCount(address, 'pending'),
}) {
  const transactionCount = await fetchTransactionCount(depositAddress);
  const attempts = [];
  let chainId = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptGasPriceWei = (
      (baseGasPriceWei * (100n + BigInt(gasPriceBumpPercent) * BigInt(attempt))) / 100n
    );
    const unsignedTransfer = await buildUnsignedUsdtTransfer({
      depositAddress,
      nonce: transactionCount,
      gasPriceWei: attemptGasPriceWei,
      gasLimit,
      usdtBalanceWei,
      provider,
    });
    chainId = unsignedTransfer.chainId;
    attempts.push({
      gasPriceWei: attemptGasPriceWei.toString(),
      unsignedTransaction: ethers.Transaction.from(unsignedTransfer).unsignedSerialized,
    });
  }

  return {
    nonce: transactionCount,
    chainId: chainId === null ? null : chainId.toString(),
    attempts,
  };
}

export const SWEEP_TRANSACTION_REVERTED_ERROR_CODE = 'SWEEP_TRANSACTION_REVERTED';

export const SWEEP_BROADCAST_DEFINITIVE_ERROR_CODES = Object.freeze([
  'INSUFFICIENT_FUNDS',
  'CALL_EXCEPTION',
  'UNPREDICTABLE_GAS_LIMIT',
  'INVALID_ARGUMENT',
  SWEEP_TRANSACTION_REVERTED_ERROR_CODE,
]);

export function buildSweepTransactionRevertedError(transactionHash) {
  const revertedError = new Error(
    `Sweep transaction ${transactionHash ?? '(unknown)'} reverted on chain`
  );
  revertedError.code = SWEEP_TRANSACTION_REVERTED_ERROR_CODE;
  return revertedError;
}

export function isDefinitiveSweepBroadcastError(broadcastError) {
  return SWEEP_BROADCAST_DEFINITIVE_ERROR_CODES.includes(broadcastError?.code);
}

/**
 * Signs and broadcasts the USDT transfer, raising the gas price on each retry.
 *
 * The nonce is read once. A retry is a replacement of the same transaction, so
 * reading the nonce again after a failed broadcast would produce a different
 * transaction that could be mined alongside the first one and move the deposit
 * balance twice.
 *
 * A broadcast error only means "we did not learn the result", not "the transfer
 * did not happen": the node may have accepted the transaction and timed out on
 * the response. The receipt is therefore checked before another attempt is made,
 * and the hash is persisted through onTransactionBroadcast as soon as the node
 * reports it.
 */
export async function broadcastSweepTransactionWithGasBumpRetry({
  provider,
  depositAddress,
  derivationIndex,
  usdtBalanceWei,
  gasLimit,
  baseGasPriceWei,
  maxRetries,
  gasPriceBumpPercent,
  signSweepTransaction,
  fetchTransactionCount,
  fetchTransactionReceipt = (transactionHash) =>
    provider.getTransactionReceipt(transactionHash),
  onTransactionBroadcast = async () => {},
}) {
  const transactionCount = await fetchTransactionCount(depositAddress);
  let lastBroadcastError;
  let latestBroadcastTransactionHash = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptGasPriceWei = (
      (baseGasPriceWei * (100n + BigInt(gasPriceBumpPercent) * BigInt(attempt))) / 100n
    );

    try {
      const unsignedTransfer = await buildUnsignedUsdtTransfer({
        depositAddress,
        nonce: transactionCount,
        gasPriceWei: attemptGasPriceWei,
        gasLimit,
        usdtBalanceWei,
        provider,
      });
      const serializedSweepTransaction = await signSweepTransaction(derivationIndex, unsignedTransfer);
      const broadcastResponse = await provider.broadcastTransaction(serializedSweepTransaction);

      if (broadcastResponse.hash) {
        latestBroadcastTransactionHash = broadcastResponse.hash;
        await onTransactionBroadcast(broadcastResponse.hash);
      }

      const minedReceipt = await broadcastResponse.wait();
      if (minedReceipt && minedReceipt.status === 0) {
        throw buildSweepTransactionRevertedError(
          minedReceipt.hash ?? latestBroadcastTransactionHash
        );
      }
      return minedReceipt;
    } catch (broadcastError) {
      lastBroadcastError = broadcastError;

      if (latestBroadcastTransactionHash) {
        const confirmedReceipt = await fetchTransactionReceipt(
          latestBroadcastTransactionHash
        ).catch(() => null);
        if (confirmedReceipt) {
          if (confirmedReceipt.status === 0) {
            throw buildSweepTransactionRevertedError(latestBroadcastTransactionHash);
          }
          return confirmedReceipt;
        }
      }

      if (isDefinitiveSweepBroadcastError(broadcastError)) {
        throw new Error(
          `Sweep broadcast rejected definitively: ${broadcastError.message}`
        );
      }

      if (attempt >= maxRetries) {
        throw new Error(
          `Sweep broadcast failed after ${attempt + 1} attempt(s): ${broadcastError.message}`
        );
      }
    }
  }

  throw lastBroadcastError;
}

export const SWEEP_RECOVERY_NO_UNFINISHED_SWEEP = 'NO_UNFINISHED_SWEEP';
export const SWEEP_RECOVERY_AWAITING_BROADCAST = 'AWAITING_BROADCAST';
export const SWEEP_RECOVERY_AWAITING_BROADCAST_CONFIRMATION = 'AWAITING_BROADCAST_CONFIRMATION';
export const SWEEP_RECOVERY_REVERTED_ON_CHAIN = 'SWEEP_REVERTED_ON_CHAIN';

/**
 * Finishes a sweep that was started but never marked complete, usually because
 * the process stopped between the broadcast and the database write.
 *
 * The receipt, not the local balance, is the authority here: if the stored
 * transaction hash is mined then the deposit has already left, and completing
 * the record is the only correct action. Re-broadcasting instead would try to
 * move a balance that is no longer there.
 */
export async function recoverUnfinishedSweepForOrder(orderRow, dependencies = {}) {
  const {
    provider = createUsdtProvider(),
    fetchTransactionReceipt = (transactionHash) =>
      provider.getTransactionReceipt(transactionHash),
  } = dependencies;

  const unfinishedSweepRecord = await fetchUnfinishedSweepRecordByOrderId(orderRow.order_id);
  if (!unfinishedSweepRecord) {
    return { swept: false, reason: SWEEP_RECOVERY_NO_UNFINISHED_SWEEP };
  }
  if (!unfinishedSweepRecord.tx_hash) {
    return { swept: false, reason: SWEEP_RECOVERY_AWAITING_BROADCAST };
  }

  const minedReceipt = await fetchTransactionReceipt(unfinishedSweepRecord.tx_hash);
  if (!minedReceipt) {
    return { swept: false, reason: SWEEP_RECOVERY_AWAITING_BROADCAST_CONFIRMATION };
  }
  if (minedReceipt.status === 0) {
    await markSweepRecordAsFailed(
      unfinishedSweepRecord.id,
      `Sweep transaction ${unfinishedSweepRecord.tx_hash} reverted on chain`
    );
    return { swept: false, reason: SWEEP_RECOVERY_REVERTED_ON_CHAIN };
  }

  const recordedTxHash = minedReceipt.hash ?? unfinishedSweepRecord.tx_hash;
  const completion = await completeSweepRecordWithTreasuryMovement({
    sweepId: unfinishedSweepRecord.id,
    orderId: orderRow.order_id,
    txHash: recordedTxHash,
    gasUsed: minedReceipt.gasUsed === undefined ? null : Number(minedReceipt.gasUsed),
    blockNumber: minedReceipt.blockNumber ?? null,
    blockHash: minedReceipt.blockHash ?? null,
    gasPriceWei: unfinishedSweepRecord.gas_price_wei
      ? BigInt(unfinishedSweepRecord.gas_price_wei)
      : null,
    amountUsdt: convertUsdtWeiToUsdtAmount(BigInt(unfinishedSweepRecord.amount_wei ?? 0)),
    confirmedAt: new Date(),
  });

  return {
    swept: true,
    recovered: true,
    sweepId: unfinishedSweepRecord.id,
    txHash: recordedTxHash,
    completion,
  };
}

export const SWEEP_PREPARATION_ALREADY_HANDLED = 'SWEEP_PREPARATION_ALREADY_HANDLED';
export const SWEEP_PREPARATION_NOT_COLLECTABLE = 'SWEEP_PREPARATION_NOT_COLLECTABLE';
export const SWEEP_PREPARATION_READY_FOR_SIGNING = 'SWEEP_PREPARATION_READY_FOR_SIGNING';

/**
 * The shared first half of a collection: recover or abandon a previous
 * unfinished sweep, check readiness, create the sweep row, and fund the
 * deposit address with BNB.
 *
 * Funding does not need the deposit seed (the gas wallet is a separate hot
 * key), so it stays on the server even when signing happens offline. Both the
 * in-process path and the offline prepare/sign/submit path call this, which
 * keeps the balance, budget and recovery rules in one place.
 */
export async function prepareSweepRecordWithFundedGas(orderRow, dependencies = {}) {
  const {
    provider = createUsdtProvider(),
    fetchUsdtBalance = fetchUsdtBalanceAtDepositAddress,
    fetchBnbBalance = fetchBnbBalanceAtDepositAddress,
    fundDepositAddress = transferBnbFromGasWalletToDepositAddress,
    fetchGasPrice = fetchCurrentBscGasPrice,
    computeSweepFee = null,
    fetchTransactionReceipt = (transactionHash) =>
      provider.getTransactionReceipt(transactionHash),
    fetchDailySponsoredBnbWei = fetchSponsoredBnbSpentInRollingWindow,
    gasSponsorshipLimits = resolveGasSponsorshipLimits(),
    cycleSpentBnbWei = 0n,
    maxRetries = getSweepMaxRetries(),
    gasPriceBumpPercent = getSweepGasPriceBumpPercent(),
    triggeredBy = 'scheduled',
    now = new Date(),
  } = dependencies;

  const recoveryResult = await recoverUnfinishedSweepForOrder(orderRow, {
    provider,
    fetchTransactionReceipt,
  });
  if (recoveryResult.swept) {
    return {
      preparationStatus: SWEEP_PREPARATION_ALREADY_HANDLED,
      sweepResult: recoveryResult,
    };
  }
  if (
    recoveryResult.reason !== SWEEP_RECOVERY_NO_UNFINISHED_SWEEP
    && recoveryResult.reason !== SWEEP_RECOVERY_AWAITING_BROADCAST
  ) {
    return {
      preparationStatus: SWEEP_PREPARATION_ALREADY_HANDLED,
      sweepResult: recoveryResult,
    };
  }
  if (recoveryResult.reason === SWEEP_RECOVERY_AWAITING_BROADCAST) {
    await markUnfinishedSweepRecordAsFailed(
      orderRow.order_id,
      'Sweep transaction was never broadcast; a new attempt replaced it'
    );
  }

  const resolvedGasWalletSigner = await createSweepGasWalletSigner(provider, dependencies);

  const depositAddress = orderRow.deposit_address;
  const derivationIndex = orderRow.derivation_index;
  const gasLimit = Number(process.env.SWEEP_ESTIMATED_GAS_UNITS || 65000);

  const usdtBalanceWei = await fetchUsdtBalance(depositAddress, provider);
  const collectionReadiness = evaluateDepositCollectionReadiness({
    balanceUsdt: convertUsdtWeiToUsdtAmount(usdtBalanceWei),
    expectedAmountUsdt: orderRow.amount_usdt,
    confirmedAt: orderRow.confirmed_at,
    now,
  });
  if (!collectionReadiness.collectable) {
    return {
      preparationStatus: SWEEP_PREPARATION_NOT_COLLECTABLE,
      reason: collectionReadiness.reason,
    };
  }

  const treasuryAddress = getTreasuryWalletAddress();
  const sweepRecord = await createPendingSweepRecord(
    orderRow.order_id,
    depositAddress,
    usdtBalanceWei,
    { triggeredBy, treasuryAddress }
  );
  const bnbBalanceWei = await fetchBnbBalance(depositAddress, provider);

  const currentGasPriceWei = await fetchGasPrice(provider);
  const maxBumpedGasPriceWei = (
    (currentGasPriceWei * (100n + BigInt(gasPriceBumpPercent) * BigInt(maxRetries))) / 100n
  );

  let sweepFeeWei;
  if (computeSweepFee) {
    sweepFeeWei = await computeSweepFee(provider);
  } else {
    sweepFeeWei = computeSweepGasFeeWei(
      maxBumpedGasPriceWei,
      gasLimit,
      Number(process.env.SWEEP_GAS_BUFFER_PERCENT || 20)
    );
  }

  let bnbFundedWei = 0n;
  if (bnbBalanceWei < sweepFeeWei) {
    bnbFundedWei = sweepFeeWei - bnbBalanceWei;

    const dailySpentBnbWei = await fetchDailySponsoredBnbWei();
    const sponsorshipDecision = evaluateGasSponsorshipDecision({
      requestedBnbWei: bnbFundedWei,
      cycleSpentBnbWei,
      dailySpentBnbWei,
      limits: gasSponsorshipLimits,
    });
    if (!sponsorshipDecision.allowed) {
      const refusalMessage = buildGasSponsorshipRefusalMessage({
        orderId: orderRow.order_id,
        depositAddress,
        sponsorshipDecision,
      });
      await markSweepRecordAsFailed(sweepRecord.id, refusalMessage);
      throw new GasSponsorshipLimitExceededError(refusalMessage, sponsorshipDecision);
    }

    await fundDepositAddress(depositAddress, bnbFundedWei, resolvedGasWalletSigner);
  }
  await markSweepAsFunded(sweepRecord.id, bnbFundedWei);

  return {
    preparationStatus: SWEEP_PREPARATION_READY_FOR_SIGNING,
    sweepRecord,
    depositAddress,
    derivationIndex,
    usdtBalanceWei,
    bnbFundedWei,
    gasLimit,
    baseGasPriceWei: currentGasPriceWei,
    maxRetries,
    gasPriceBumpPercent,
  };
}

/**
 * Executes the fund-then-sweep for one paid order: ensures the deposit address
 * has enough BNB to pay for a USDT transfer, then signs + broadcasts the sweep
 * with automatic gas-price bumping on retry.
 *
 * This in-process path is for development and tests only. Production uses
 * prepareSweepBatchForOfflineSigning + signPreparedSweepBatchWithMasterMnemonic
 * + submitSignedSweepBatch, so the seed never reaches the API host.
 */
export async function sweepSingleOrder(orderRow, dependencies = {}) {
  const provider = dependencies.provider ?? createUsdtProvider();
  const signSweepTransaction = dependencies.signSweepTransaction
    ?? signSerializedTransactionWithDerivedKey;
  const fetchTransactionCount = dependencies.fetchTransactionCount
    ?? ((depositAddress) => provider.getTransactionCount(depositAddress, 'pending'));
  const fetchTransactionReceipt = dependencies.fetchTransactionReceipt
    ?? ((transactionHash) => provider.getTransactionReceipt(transactionHash));

  const preparation = await prepareSweepRecordWithFundedGas(orderRow, {
    ...dependencies,
    provider,
  });

  if (preparation.preparationStatus === SWEEP_PREPARATION_ALREADY_HANDLED) {
    return preparation.sweepResult;
  }
  if (preparation.preparationStatus === SWEEP_PREPARATION_NOT_COLLECTABLE) {
    return { swept: false, reason: preparation.reason };
  }

  const {
    sweepRecord,
    depositAddress,
    derivationIndex,
    usdtBalanceWei,
    baseGasPriceWei,
    gasLimit,
    maxRetries,
    gasPriceBumpPercent,
  } = preparation;

  const confirmedSweepReceipt = await broadcastSweepTransactionWithGasBumpRetry({
    provider,
    depositAddress,
    derivationIndex,
    usdtBalanceWei,
    gasLimit,
    baseGasPriceWei,
    maxRetries,
    gasPriceBumpPercent,
    signSweepTransaction,
    fetchTransactionCount,
    fetchTransactionReceipt,
    onTransactionBroadcast: async (broadcastTransactionHash) => {
      await markSweepTransactionAsBroadcast(
        sweepRecord.id,
        broadcastTransactionHash,
        baseGasPriceWei
      );
    },
  });

  const completion = await completeSweepRecordWithTreasuryMovement({
    sweepId: sweepRecord.id,
    orderId: orderRow.order_id,
    txHash: confirmedSweepReceipt.hash,
    gasUsed: confirmedSweepReceipt.gasUsed === undefined
      ? null
      : Number(confirmedSweepReceipt.gasUsed),
    blockNumber: confirmedSweepReceipt.blockNumber ?? null,
    blockHash: confirmedSweepReceipt.blockHash ?? null,
    gasPriceWei: baseGasPriceWei,
    amountUsdt: convertUsdtWeiToUsdtAmount(usdtBalanceWei),
    confirmedAt: new Date(),
  });

  return {
    swept: true,
    sweepId: sweepRecord.id,
    txHash: confirmedSweepReceipt.hash,
    bnbFundedWei: preparation.bnbFundedWei,
    completion,
  };
}

const SWEEP_UNFINISHED_STATUSES = Object.freeze(['pending', 'funded']);

export async function markUnfinishedSweepRecordAsFailed(orderId, failureMessage) {
  const latestSweepRecord = await fetchSweepRecordByOrderId(orderId);
  if (!latestSweepRecord || !SWEEP_UNFINISHED_STATUSES.includes(latestSweepRecord.status)) {
    return;
  }
  // A row with a transaction hash has money in flight; the recovery pass decides
  // its fate from the receipt. Marking it failed here would hide a transfer that
  // may already have moved the deposit to the treasury.
  if (latestSweepRecord.tx_hash) {
    return;
  }
  await markSweepRecordAsFailed(latestSweepRecord.id, failureMessage);
}

/**
 * Runs one daily collection pass over every paid order whose payment settled
 * at least the minimum age ago. Inputs on-chain dependencies are injected so
 * the pass is deterministic in tests.
 */
export async function runSweepCycle({
  provider = createUsdtProvider(),
  gasWalletSigner,
  fetchUsdtBalance = fetchUsdtBalanceAtDepositAddress,
  fetchBnbBalance = fetchBnbBalanceAtDepositAddress,
  fundDepositAddress = transferBnbFromGasWalletToDepositAddress,
  fetchGasPrice = fetchCurrentBscGasPrice,
  signSweepTransaction = signSerializedTransactionWithDerivedKey,
  fetchTransactionReceipt = (transactionHash) =>
    provider.getTransactionReceipt(transactionHash),
  fetchSettlementFrontier = fetchChainSettlementFrontier,
  fetchDailySponsoredBnbWei = fetchSponsoredBnbSpentInRollingWindow,
  gasSponsorshipLimits = resolveGasSponsorshipLimits(),
  alertOnSweepFailure = sendTelegramAlertMessage,
  triggeredBy = 'scheduled',
  minimumAgeHours = getSweepMinimumAgeHours(),
  fetchEligibleOrders = fetchPaidOrdersEligibleForSweep,
} = {}) {
  const eligiblePaidOrders = await fetchEligibleOrders({ minimumAgeHours });

  const sweepResults = [];
  let cycleSpentBnbWei = 0n;
  for (const orderRow of eligiblePaidOrders) {
    try {
      const sweepResult = await sweepSingleOrder(orderRow, {
        provider,
        gasWalletSigner,
        fetchUsdtBalance,
        fetchBnbBalance,
        fundDepositAddress,
        fetchGasPrice,
        signSweepTransaction,
        fetchTransactionReceipt,
        fetchDailySponsoredBnbWei,
        gasSponsorshipLimits,
        cycleSpentBnbWei,
        triggeredBy,
      });
      cycleSpentBnbWei += BigInt(sweepResult.bnbFundedWei ?? 0n);
      sweepResults.push({ orderId: orderRow.order_id, ...sweepResult });
    } catch (sweepError) {
      await markUnfinishedSweepRecordAsFailed(orderRow.order_id, sweepError.message);
      const alertMessage = `Sweep failed for order ${orderRow.order_id} (deposit ${orderRow.deposit_address}): ${sweepError.message}`;
      await alertOnSweepFailure(alertMessage).catch(() => {});
      sweepResults.push({ orderId: orderRow.order_id, swept: false, reason: 'SWEEP_ERROR', message: sweepError.message });
    }
  }

  // Collections made in this cycle are now mature enough to be checked against
  // a newer finalized head. This also catches up rows left unfinalized by a
  // previous process.
  await finalizeSweepsAgainstSettlementFrontier({ provider, fetchSettlementFrontier });

  return sweepResults;
}