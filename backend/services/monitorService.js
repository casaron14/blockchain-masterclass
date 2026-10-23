import { ethers } from 'ethers';
import pool from '../config/db.js';

import { getUsdtContractAddress, DEFAULT_USDT_DECIMALS } from './usdtPaymentService.js';

import {
  fetchChainSettlementFrontier,
  verifyObservedBlockIsStillCanonical,
  fetchLatestBlockNumber,
} from './blockFinalityService.js';

import { createBscProviderPool, createBscJsonRpcProvider } from './bscProviderPool.js';
import {
  fetchConfirmableDepositAddressRecords,
  markDepositAddressAsObserved,
} from './orderService.js';

import {
  buildUnderpaymentExpiryDecision,
  evaluateOrderPaymentSettlement,
  fetchObservedDepositRecordsForOrderId,
  deleteObservedDepositForReorgedTransfer,
  fetchUnfinalizedObservedDepositRecords,
  refreshObservedDepositConfirmations,
} from './usdtSettlementService.js';

import {
  confirmUsdtOrderPaymentFromObservedDeposits,
  recordPaymentReviewFlag,
} from './usdtPaymentService.js';

export const USDT_TRANSFER_EVENT_TOPIC = ethers.id('Transfer(address,address,uint256)');

export { fetchLatestBlockNumber };

// Blocks re-read on every tick. A transfer must be seen even if it landed in a
// block the previous tick had already passed, so the cursor is treated as a
// high-water mark and re-read with a small overlap.
export function resolveScanOverlapBlockCount() {
  const configuredOverlap = Number(process.env.MONITOR_SCAN_OVERLAP_BLOCKS);
  if (Number.isFinite(configuredOverlap) && configuredOverlap > 0) {
    return configuredOverlap;
  }
  return 5;
}

export function resolveInitialScanLookbackBlockCount() {
  const configuredLookback = Number(process.env.MONITOR_INITIAL_SCAN_LOOKBACK_BLOCKS);
  if (Number.isFinite(configuredLookback) && configuredLookback > 0) {
    return configuredLookback;
  }
  return 2000;
}

// Public nodes cap how many blocks one eth_getLogs call may span, so a wide
// window is walked in chunks. 0 keeps a single call (correct for a node with no
// cap, and for tests that stub the provider).
export function resolveLogScanChunkBlockCount() {
  const configuredChunk = Number(process.env.MONITOR_LOG_SCAN_CHUNK_BLOCKS);
  if (Number.isFinite(configuredChunk) && configuredChunk > 0) {
    return configuredChunk;
  }
  return 0;
}

export function resolveUnderpaymentGracePeriodMinutes() {
  const configuredGrace = Number(process.env.UNDERPAYMENT_GRACE_PERIOD_MINUTES);
  if (Number.isFinite(configuredGrace) && configuredGrace >= 0) {
    return configuredGrace;
  }
  return 0;
}

export function buildUsdtTransferLogQuery(usdtContractAddress, fromBlock, toBlock) {
  return {
    address: usdtContractAddress,
    topics: [USDT_TRANSFER_EVENT_TOPIC],
    fromBlock: Math.max(0, Number(fromBlock)),
    toBlock: Math.max(0, Number(toBlock)),
  };
}

export function parseUsdtTransferEventLog(eventLog) {
  const usdtInterface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);
  const parsedLog = usdtInterface.parseLog({ topics: eventLog.topics, data: eventLog.data });
  if (!parsedLog || parsedLog.name !== 'Transfer') {
    return null;
  }

  const amountWei = parsedLog.args[2];
  return {
    txHash: eventLog.transactionHash,
    blockNumber: Number(eventLog.blockNumber),
    blockHash: eventLog.blockHash,
    logIndex: Number(eventLog.logIndex ?? 0),
    fromAddress: parsedLog.args[0],
    toAddress: parsedLog.args[1],
    amountWei,
    amountUsdt: Number(ethers.formatUnits(amountWei, DEFAULT_USDT_DECIMALS)),
  };
}

export async function fetchTransferEventLogsInBlockChunks(provider, usdtTransferLogQuery, chunkBlockCount) {
  const collectedEventLogs = [];
  const scanEndBlock = Number(usdtTransferLogQuery.toBlock);

  for (
    let chunkStartBlock = Number(usdtTransferLogQuery.fromBlock);
    chunkStartBlock <= scanEndBlock;
    chunkStartBlock += chunkBlockCount
  ) {
    const chunkEndBlock = Math.min(chunkStartBlock + chunkBlockCount - 1, scanEndBlock);
    const chunkEventLogs = await provider.getLogs({
      ...usdtTransferLogQuery,
      fromBlock: chunkStartBlock,
      toBlock: chunkEndBlock,
    });
    collectedEventLogs.push(...chunkEventLogs);
  }

  return collectedEventLogs;
}

export async function fetchUsdtTransferEventLogsForBlockWindow(provider, fromBlock, toBlock) {
  const usdtTransferLogQuery = buildUsdtTransferLogQuery(getUsdtContractAddress(), fromBlock, toBlock);
  const logScanChunkBlockCount = resolveLogScanChunkBlockCount();

  return logScanChunkBlockCount > 0
    ? fetchTransferEventLogsInBlockChunks(provider, usdtTransferLogQuery, logScanChunkBlockCount)
    : provider.getLogs(usdtTransferLogQuery);
}

export function parseUsdtTransferEventLogs(transferEventLogs) {
  return transferEventLogs
    .map(parseUsdtTransferEventLog)
    .filter((parsedTransfer) => parsedTransfer !== null);
}

export async function recordObservedUsdtTransfer(
  { depositAddressRecord, parsedTransfer },
  client = pool
) {
  const result = await client.query(
    `INSERT INTO deposits_observed
       (address, tx_hash, from_address, amount, amount_wei, block_number, block_hash, order_id, confirmations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     ON CONFLICT (tx_hash) DO NOTHING
     RETURNING *`,
    [
      depositAddressRecord.address,
      parsedTransfer.txHash,
      parsedTransfer.fromAddress,
      parsedTransfer.amountUsdt,
      parsedTransfer.amountWei.toString(),
      parsedTransfer.blockNumber,
      parsedTransfer.blockHash,
      depositAddressRecord.order_id,
    ]
  );

  if (result.rows.length > 0) {
    await markDepositAddressAsObserved(depositAddressRecord.id, parsedTransfer.blockNumber);
  }

  return result.rows[0] ?? null;
}

// One address lookup for every transfer found in the tick, instead of one log
// query per open order. This is what keeps a few-second poll interval viable
// against a rate-limited public node.
export async function matchTransfersToWatchedDepositAddresses(parsedTransfers) {
  if (parsedTransfers.length === 0) {
    return [];
  }

  const recipientAddresses = [...new Set(parsedTransfers.map((parsedTransfer) => parsedTransfer.toAddress))];
  const watchedAddressResult = await pool.query(
    `SELECT da.id, da.order_id, da.address, da.is_active,
            o.booking_id, o.status AS order_status, o.expires_at,
            b.status AS booking_status
       FROM deposit_addresses da
       JOIN orders o ON o.id = da.order_id
       JOIN bookings b ON b.id = o.booking_id
      WHERE LOWER(da.address) = ANY($1::text[])`,
    [recipientAddresses.map((recipientAddress) => recipientAddress.toLowerCase())]
  );

  const watchedAddressByLowerCase = new Map(
    watchedAddressResult.rows.map((row) => [
      String(row.address).toLowerCase(),
      {
        ...row,
        id: Number(row.id),
        order_id: Number(row.order_id),
        booking_id: Number(row.booking_id),
        is_active: row.is_active === true,
      },
    ])
  );

  const matchedTransfers = [];
  for (const parsedTransfer of parsedTransfers) {
    const watchedAddress = watchedAddressByLowerCase.get(
      String(parsedTransfer.toAddress).toLowerCase()
    );
    if (watchedAddress) {
      matchedTransfers.push({ depositAddressRecord: watchedAddress, parsedTransfer });
    }
  }
  return matchedTransfers;
}

export async function fetchTransferScanState() {
  const result = await pool.query('SELECT * FROM usdt_transfer_scan_state WHERE id = 1');
  const scanState = result.rows[0];
  if (!scanState) {
    return {
      lastScannedBlock: 0,
      lastFinalizedBlock: 0,
      lastScannedAt: null,
      lastError: null,
      consecutiveFailures: 0,
    };
  }
  return {
    lastScannedBlock: Number(scanState.last_scanned_block),
    lastFinalizedBlock: Number(scanState.last_finalized_block),
    lastScannedAt: scanState.last_scanned_at ? new Date(scanState.last_scanned_at) : null,
    lastError: scanState.last_error ?? null,
    consecutiveFailures: Number(scanState.consecutive_failures),
  };
}

export async function updateTransferScanStateAfterSuccessfulScan({
  scannedToBlock,
  finalizedBlockNumber,
}) {
  await pool.query(
    `UPDATE usdt_transfer_scan_state
        SET last_scanned_block = GREATEST(last_scanned_block, $1),
            last_finalized_block = GREATEST(last_finalized_block, $2),
            last_scanned_at = now(),
            last_error = NULL,
            consecutive_failures = 0,
            updated_at = now()
      WHERE id = 1`,
    [scannedToBlock, finalizedBlockNumber]
  );
}

export async function updateTransferScanStateAfterFailedScan(errorMessage) {
  await pool.query(
    `UPDATE usdt_transfer_scan_state
        SET last_error = $1,
            consecutive_failures = consecutive_failures + 1,
            updated_at = now()
      WHERE id = 1`,
    [String(errorMessage).slice(0, 500)]
  );
}

export function computeNextScanStartBlock({ lastScannedBlock, latestBlockNumber }) {
  const overlapBlockCount = resolveScanOverlapBlockCount();
  if (lastScannedBlock <= 0) {
    return Math.max(0, latestBlockNumber - resolveInitialScanLookbackBlockCount());
  }
  return Math.max(0, lastScannedBlock - overlapBlockCount);
}

// A deposit read from a block that a short reorg replaced is not a payment.
// Before anything is confirmed, the blocks behind the unfinalized deposits are
// re-read and the record is dropped if the hash no longer matches.
export async function dropObservedDepositsFromReorgedBlocks(provider) {
  const unfinalizedDeposits = await fetchUnfinalizedObservedDepositRecords();
  const droppedDeposits = [];

  for (const unfinalizedDeposit of unfinalizedDeposits) {
    if (!unfinalizedDeposit.block_hash) {
      continue;
    }
    const isStillCanonical = await verifyObservedBlockIsStillCanonical(
      provider,
      unfinalizedDeposit.block_number,
      unfinalizedDeposit.block_hash
    );
    if (!isStillCanonical) {
      const droppedDeposit = await deleteObservedDepositForReorgedTransfer(unfinalizedDeposit.id);
      droppedDeposits.push(droppedDeposit);
    }
  }

  return droppedDeposits;
}

async function confirmSettledOrderPayments({
  settlementFrontier,
  confirmOrderPayment,
  processOrderCandidate,
}) {
  const confirmableAddressRecords = await fetchConfirmableDepositAddressRecords();
  const orderCandidateByOrderId = new Map();
  for (const confirmableAddressRecord of confirmableAddressRecords) {
    orderCandidateByOrderId.set(confirmableAddressRecord.order_id, confirmableAddressRecord);
  }

  const confirmationResults = [];

  for (const orderCandidate of orderCandidateByOrderId.values()) {
    try {
      const orderOutcome = await processOrderCandidate({
        orderCandidate,
        settlementFrontier,
        confirmOrderPayment,
      });
      if (orderOutcome) {
        confirmationResults.push(orderOutcome);
      }
    } catch (error) {
      // One order must never stop the others: a single sold-out booking or a
      // malformed deposit used to abort the whole tick, including every other
      // pending payment.
      console.error(
        `Usdt listener failed to process order ${orderCandidate.order_id}:`,
        error.message
      );
      confirmationResults.push({
        orderId: orderCandidate.order_id,
        confirmed: false,
        error: error.message,
      });
    }
  }

  return confirmationResults;
}

async function processOrderCandidateForSettlement({
  orderCandidate,
  settlementFrontier,
  confirmOrderPayment,
  chainId,
}) {
  const observedDeposits = await fetchObservedDepositRecordsForOrderId(orderCandidate.order_id);
  if (observedDeposits.length === 0) {
    return null;
  }

  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord: { amount_expected: orderCandidate.amount_expected },
    observedDeposits,
    settlementFrontier,
  });

  if (settlementDecision.ready) {
    return confirmOrderPayment({
      orderId: orderCandidate.order_id,
      bookingId: orderCandidate.booking_id,
      paymentId: orderCandidate.payment_id,
      depositAddress: orderCandidate.address,
      observedDeposits,
      settlementFrontier,
      chainId,
    });
  }

  if (settlementDecision.reason === 'AMOUNT_UNDERPAID') {
    const underpaymentDecision = buildUnderpaymentExpiryDecision({
      observedAmountWei: settlementDecision.totalAmountWei,
      expectedAmountWei: settlementDecision.expectedAmountWei,
      orderExpired: new Date(orderCandidate.expires_at) <= new Date(),
      underpaymentGracePeriodMinutes: resolveUnderpaymentGracePeriodMinutes(),
    });

    if (underpaymentDecision.abandoned) {
      await recordPaymentReviewFlag({
        orderId: orderCandidate.order_id,
        bookingId: orderCandidate.booking_id,
        paymentId: orderCandidate.payment_id,
        depositAddress: orderCandidate.address,
        amount: settlementDecision.totalAmountUsdt,
        reason: 'underpayment_after_window',
        details: { shortfallWei: underpaymentDecision.shortfallWei.toString() },
        autoAction: 'review_required',
      });
      return {
        orderId: orderCandidate.order_id,
        confirmed: false,
        reason: 'UNDERPAYMENT_AFTER_HOLD_EXPIRED',
      };
    }
  }

  return null;
}

export function buildListenerTickSummary({
  providerUrl,
  scannedFromBlock,
  scannedToBlock,
  transferCount,
  matchedTransferCount,
  recordedTransferCount,
  droppedReorgedDepositCount,
  confirmationResults,
  durationMs,
}) {
  return {
    providerUrl,
    scannedFromBlock,
    scannedToBlock,
    transferCount,
    matchedTransferCount,
    recordedTransferCount,
    droppedReorgedDepositCount,
    confirmedCount: confirmationResults.filter((result) => result.confirmed === true).length,
    confirmationResults,
    durationMs,
  };
}

// One tick of the payment listener.
//
// 1. read the settlement frontier (head + finalized head) once
// 2. read the token contract's Transfer logs for the scan window in ONE query
// 3. attribute those transfers to known deposit addresses in SQL
// 4. record every new transfer, then drop any that a reorg invalidated
// 5. settle each order whose payment is complete, one transaction per order
//
// The whole tick costs a constant number of RPC calls regardless of how many
// orders are open, which is what allows a short interval on a public node.
export async function runUsdtTransferListenerTick({ provider, providerPool, chainId } = {}) {
  const tickStartedAt = Date.now();
  const activeProviderPool = providerPool ?? createBscProviderPool();
  const activeProvider = provider ?? createBscJsonRpcProvider(activeProviderPool.getActiveCandidateUrl());

  let resolvedChainId;
  let settlementFrontier;
  let scanState;

  try {
    // The chain id is resolved INSIDE this try on purpose. When CHAIN_ID is
    // unset the provider has to ask the node which network it is on, and that
    // call goes over the same rate-limited public endpoint as everything else.
    // Resolving it outside the try meant a throttled node threw before the pool
    // was told anything, so the endpoint was never rotated away from and every
    // tick retried the same dead URL for ever.
    resolvedChainId =
      chainId ??
      (process.env.CHAIN_ID
        ? Number(process.env.CHAIN_ID)
        : Number((await activeProvider.getNetwork()).chainId));

    settlementFrontier = await fetchChainSettlementFrontier(activeProvider);
    scanState = await fetchTransferScanState();
  } catch (error) {
    activeProviderPool.markActiveCandidateAsFailed(error);
    await updateTransferScanStateAfterFailedScan(error.message);
    throw error;
  }

  const scanStartBlock = computeNextScanStartBlock({
    lastScannedBlock: scanState.lastScannedBlock,
    latestBlockNumber: settlementFrontier.latestBlockNumber,
  });

  let transferEventLogs = [];
  try {
    transferEventLogs = await fetchUsdtTransferEventLogsForBlockWindow(
      activeProvider,
      scanStartBlock,
      settlementFrontier.latestBlockNumber
    );
    activeProviderPool.markActiveCandidateAsHealthy();
  } catch (error) {
    activeProviderPool.markActiveCandidateAsFailed(error);
    await updateTransferScanStateAfterFailedScan(error.message);
    throw error;
  }

  const parsedTransfers = parseUsdtTransferEventLogs(transferEventLogs);
  const matchedTransfers = await matchTransfersToWatchedDepositAddresses(parsedTransfers);

  let recordedTransferCount = 0;
  for (const matchedTransfer of matchedTransfers) {
    const recordedTransfer = await recordObservedUsdtTransfer(matchedTransfer);
    if (recordedTransfer) {
      recordedTransferCount += 1;
    }
  }

  const droppedReorgedDeposits = await dropObservedDepositsFromReorgedBlocks(activeProvider);

  await refreshObservedDepositConfirmations(settlementFrontier.latestBlockNumber);
  await updateTransferScanStateAfterSuccessfulScan({
    scannedToBlock: settlementFrontier.latestBlockNumber,
    finalizedBlockNumber: settlementFrontier.finalizedBlockNumber,
  });

  const confirmationResults = await confirmSettledOrderPayments({
    settlementFrontier,
    chainId: resolvedChainId,
    confirmOrderPayment: confirmUsdtOrderPaymentFromObservedDeposits,
    processOrderCandidate: processOrderCandidateForSettlement,
  });

  return buildListenerTickSummary({
    providerUrl: activeProviderPool.getActiveCandidateUrl(),
    scannedFromBlock: scanStartBlock,
    scannedToBlock: settlementFrontier.latestBlockNumber,
    transferCount: parsedTransfers.length,
    matchedTransferCount: matchedTransfers.length,
    recordedTransferCount,
    droppedReorgedDepositCount: droppedReorgedDeposits.length,
    confirmationResults,
    durationMs: Date.now() - tickStartedAt,
  });
}
