import { ethers } from 'ethers';

import { createUsdtProvider } from './usdtPaymentService.js';

import {
  buildSweepTransactionRevertedError,
  completeSweepRecordWithTreasuryMovement,
  convertUsdtWeiToUsdtAmount,
  fetchSweepRecordById,
  isDefinitiveSweepBroadcastError,
  markSweepTransactionAsBroadcast,
  markUnfinishedSweepRecordAsFailed,
  recoverUnfinishedSweepForOrder,
} from './sweepService.js';

export const SWEEP_BATCH_SUBMISSION_SWEPT = 'SWEPT';
export const SWEEP_BATCH_SUBMISSION_ALREADY_COMPLETED = 'ALREADY_COMPLETED';
export const SWEEP_BATCH_SUBMISSION_AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION';
export const SWEEP_BATCH_SUBMISSION_FAILED = 'FAILED';

const USDT_TRANSFER_INTERFACE = new ethers.Interface([
  'function transfer(address to, uint256 value)',
]);

function normalizeAddress(address) {
  return String(address ?? '').toLowerCase();
}

function assertSignedSweepBatchHasUsableShape(signedBatch) {
  if (!signedBatch || !Array.isArray(signedBatch.items)) {
    throw new Error('Signed sweep batch has no items array');
  }
  if (!signedBatch.network || !signedBatch.network.usdtContractAddress) {
    throw new Error('Signed sweep batch has no network configuration');
  }
  if (!signedBatch.network.treasuryAddress) {
    throw new Error('Signed sweep batch has no treasury address');
  }
}

function assertSignedSweepAttemptMatchesBatchItem({
  batchItem,
  batchNetwork,
  attempt,
  signedTransaction,
}) {
  const expectedUsdtContractAddress = normalizeAddress(batchNetwork.usdtContractAddress);
  const expectedTreasuryAddress = normalizeAddress(batchNetwork.treasuryAddress);

  if (normalizeAddress(signedTransaction.from) !== normalizeAddress(batchItem.depositAddress)) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} was signed by `
      + `${signedTransaction.from}, not by the deposit address ${batchItem.depositAddress}`
    );
  }
  if (normalizeAddress(signedTransaction.to) !== expectedUsdtContractAddress) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} targets `
      + `${signedTransaction.to}, not the configured USDT contract ${batchNetwork.usdtContractAddress}`
    );
  }
  if (String(signedTransaction.chainId) !== String(batchItem.chainId)) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} is for chain `
      + `${signedTransaction.chainId}, expected ${batchItem.chainId}`
    );
  }
  if (signedTransaction.nonce !== batchItem.nonce) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} uses nonce `
      + `${signedTransaction.nonce}, expected ${batchItem.nonce}`
    );
  }
  if (
    batchItem.gasLimit !== undefined
    && signedTransaction.gasLimit.toString() !== String(batchItem.gasLimit)
  ) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} has gas limit `
      + `${signedTransaction.gasLimit}, expected ${batchItem.gasLimit}`
    );
  }
  if (
    attempt.gasPriceWei !== undefined
    && signedTransaction.gasPrice.toString() !== String(attempt.gasPriceWei)
  ) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} has gas price `
      + `${signedTransaction.gasPrice}, expected ${attempt.gasPriceWei}`
    );
  }
  if (signedTransaction.value !== 0n) {
    throw new Error(`Signed sweep for order ${batchItem.orderId} must not send BNB`);
  }

  let decodedTransfer;
  try {
    decodedTransfer = USDT_TRANSFER_INTERFACE.parseTransaction({
      data: signedTransaction.data,
    });
  } catch {
    throw new Error(`Signed sweep for order ${batchItem.orderId} is not a USDT transfer`);
  }
  if (!decodedTransfer || decodedTransfer.name !== 'transfer') {
    throw new Error(`Signed sweep for order ${batchItem.orderId} is not a USDT transfer`);
  }
  if (normalizeAddress(decodedTransfer.args[0]) !== expectedTreasuryAddress) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} sends USDT to `
      + `${decodedTransfer.args[0]}, not the treasury ${batchNetwork.treasuryAddress}`
    );
  }
  if (decodedTransfer.args[1].toString() !== String(batchItem.amountWei)) {
    throw new Error(
      `Signed sweep for order ${batchItem.orderId} sends `
      + `${decodedTransfer.args[1]}, expected ${batchItem.amountWei}`
    );
  }
}

async function loadSweepRecordMatchingSignedBatchItem({
  batchItem,
  fetchSweepRecord,
}) {
  const sweepRecord = await fetchSweepRecord(batchItem.sweepId);
  if (!sweepRecord) {
    throw new Error(
      `Sweep record ${batchItem.sweepId} for order ${batchItem.orderId} no longer exists`
    );
  }
  if (normalizeAddress(sweepRecord.address) !== normalizeAddress(batchItem.depositAddress)) {
    throw new Error(
      `Sweep record ${batchItem.sweepId} belongs to ${sweepRecord.address}, `
      + `not ${batchItem.depositAddress}`
    );
  }
  if (Number(sweepRecord.order_id) !== Number(batchItem.orderId)) {
    throw new Error(
      `Sweep record ${batchItem.sweepId} belongs to order ${sweepRecord.order_id}, `
      + `not ${batchItem.orderId}`
    );
  }
  if (BigInt(sweepRecord.amount_wei) !== BigInt(batchItem.amountWei)) {
    throw new Error(
      `Sweep record ${batchItem.sweepId} records ${sweepRecord.amount_wei}, `
      + `but the signed batch moves ${batchItem.amountWei}`
    );
  }
  return sweepRecord;
}

function assertSignedAttemptsAreSafeToBroadcast({ batchItem, batchNetwork }) {
  if (!Array.isArray(batchItem.attempts) || batchItem.attempts.length === 0) {
    throw new Error(`Signed sweep for order ${batchItem.orderId} has no signed attempts`);
  }
  return batchItem.attempts.map((attempt) => {
    if (!attempt || typeof attempt.rawTransaction !== 'string') {
      throw new Error(
        `Signed sweep for order ${batchItem.orderId} has no raw transaction. `
        + 'Run npm run sweep:sign first.'
      );
    }
    const signedTransaction = ethers.Transaction.from(attempt.rawTransaction);
    assertSignedSweepAttemptMatchesBatchItem({
      batchItem,
      batchNetwork,
      attempt,
      signedTransaction,
    });
    if (
      attempt.transactionHash
      && normalizeAddress(attempt.transactionHash) !== normalizeAddress(signedTransaction.hash)
    ) {
      throw new Error(
        `Signed sweep for order ${batchItem.orderId} declares `
        + `${attempt.transactionHash}, but the transaction hashes to ${signedTransaction.hash}`
      );
    }
    return { attempt, signedTransaction };
  });
}

async function broadcastSignedSweepAttempts({
  provider,
  batchItem,
  sweepRecordId,
  parsedAttempts,
  fetchTransactionReceipt,
}) {
  let lastBroadcastError = null;

  for (let attemptIndex = 0; attemptIndex < parsedAttempts.length; attemptIndex++) {
    const { attempt, signedTransaction } = parsedAttempts[attemptIndex];

    try {
      const broadcastResponse = await provider.broadcastTransaction(attempt.rawTransaction);
      if (
        broadcastResponse.hash
        && normalizeAddress(broadcastResponse.hash) !== normalizeAddress(signedTransaction.hash)
      ) {
        throw new Error(
          `Node returned transaction hash ${broadcastResponse.hash}, but the signed `
          + `transaction hashes to ${signedTransaction.hash}`
        );
      }
      await markSweepTransactionAsBroadcast(
        sweepRecordId,
        signedTransaction.hash,
        signedTransaction.gasPrice
      );

      const minedReceipt = await broadcastResponse.wait();
      if (minedReceipt && minedReceipt.status === 0) {
        throw buildSweepTransactionRevertedError(
          minedReceipt.hash ?? signedTransaction.hash
        );
      }
      return { receipt: minedReceipt, signedTransaction };
    } catch (broadcastError) {
      lastBroadcastError = broadcastError;

      const confirmedReceipt = await fetchTransactionReceipt(
        signedTransaction.hash
      ).catch(() => null);
      if (confirmedReceipt) {
        if (confirmedReceipt.status === 0) {
          throw buildSweepTransactionRevertedError(signedTransaction.hash);
        }
        return { receipt: confirmedReceipt, signedTransaction };
      }

      if (isDefinitiveSweepBroadcastError(broadcastError)) {
        throw new Error(
          `Sweep broadcast rejected definitively: ${broadcastError.message}`
        );
      }

      if (attemptIndex === parsedAttempts.length - 1) {
        throw new Error(
          `Sweep broadcast failed after ${parsedAttempts.length} attempt(s): `
          + `${broadcastError.message}`
        );
      }
    }
  }

  throw lastBroadcastError;
}

async function submitValidatedSweepBatchItem({
  batchItem,
  sweepRecord,
  parsedAttempts,
  provider,
  fetchTransactionReceipt,
}) {
  if (sweepRecord.status === 'swept') {
    return {
      orderId: batchItem.orderId,
      sweepId: sweepRecord.id,
      status: SWEEP_BATCH_SUBMISSION_ALREADY_COMPLETED,
      txHash: sweepRecord.tx_hash,
    };
  }

  if (sweepRecord.status === 'failed') {
    throw new Error(
      `Sweep record ${sweepRecord.id} is marked failed: ${sweepRecord.failure_reason ?? 'no reason'}`
    );
  }

  if (sweepRecord.tx_hash) {
    const recoveryResult = await recoverUnfinishedSweepForOrder(
      { order_id: sweepRecord.order_id },
      { provider, fetchTransactionReceipt }
    );
    if (recoveryResult.swept) {
      return {
        orderId: batchItem.orderId,
        sweepId: sweepRecord.id,
        status: SWEEP_BATCH_SUBMISSION_ALREADY_COMPLETED,
        txHash: recoveryResult.txHash,
      };
    }
    return {
      orderId: batchItem.orderId,
      sweepId: sweepRecord.id,
      status: SWEEP_BATCH_SUBMISSION_AWAITING_CONFIRMATION,
      txHash: sweepRecord.tx_hash,
      reason: recoveryResult.reason,
    };
  }

  try {
    const { receipt, signedTransaction } = await broadcastSignedSweepAttempts({
      provider,
      batchItem,
      sweepRecordId: sweepRecord.id,
      parsedAttempts,
      fetchTransactionReceipt,
    });

    const completion = await completeSweepRecordWithTreasuryMovement({
      sweepId: sweepRecord.id,
      orderId: sweepRecord.order_id,
      txHash: receipt.hash ?? signedTransaction.hash,
      gasUsed: receipt.gasUsed === undefined ? null : Number(receipt.gasUsed),
      blockNumber: receipt.blockNumber ?? null,
      blockHash: receipt.blockHash ?? null,
      gasPriceWei: signedTransaction.gasPrice,
      amountUsdt: convertUsdtWeiToUsdtAmount(BigInt(sweepRecord.amount_wei)),
      confirmedAt: new Date(),
    });

    return {
      orderId: batchItem.orderId,
      sweepId: sweepRecord.id,
      status: SWEEP_BATCH_SUBMISSION_SWEPT,
      txHash: receipt.hash ?? signedTransaction.hash,
      completion,
    };
  } catch (broadcastError) {
    await markUnfinishedSweepRecordAsFailed(
      sweepRecord.order_id,
      broadcastError.message
    );
    throw broadcastError;
  }
}

/**
 * Online half of the offline flow: verifies every signed item against the
 * database and the prepared network before broadcasting anything, then
 * broadcasts, waits for the receipt and records the sweep + ledger in one
 * transaction.
 *
 * The signature is recovered and checked against each deposit address, so a
 * signed batch produced with the wrong mnemonic, or altered after signing,
 * cannot move funds even if it is fed to this function.
 */
export async function submitSignedSweepBatch(signedBatch, {
  provider = createUsdtProvider(),
  fetchSweepRecord = fetchSweepRecordById,
  fetchTransactionReceipt = (transactionHash) =>
    provider.getTransactionReceipt(transactionHash),
  fetchTransactionCount = (depositAddress) =>
    provider.getTransactionCount(depositAddress, 'pending'),
} = {}) {
  assertSignedSweepBatchHasUsableShape(signedBatch);

  const validatedItems = [];
  for (const batchItem of signedBatch.items) {
    const sweepRecord = await loadSweepRecordMatchingSignedBatchItem({
      batchItem,
      fetchSweepRecord,
    });

    let parsedAttempts = null;
    if (sweepRecord.status !== 'swept' && !sweepRecord.tx_hash) {
      parsedAttempts = assertSignedAttemptsAreSafeToBroadcast({
        batchItem,
        batchNetwork: signedBatch.network,
      });

      const currentTransactionCount = await fetchTransactionCount(
        batchItem.depositAddress
      );
      if (currentTransactionCount !== batchItem.nonce) {
        throw new Error(
          `Deposit ${batchItem.depositAddress} is now at nonce `
          + `${currentTransactionCount}, but the signed batch was prepared for nonce `
          + `${batchItem.nonce}. The batch is stale; prepare a new one.`
        );
      }
    }

    validatedItems.push({ batchItem, sweepRecord, parsedAttempts });
  }

  const results = [];
  for (const { batchItem, sweepRecord, parsedAttempts } of validatedItems) {
    try {
      results.push(await submitValidatedSweepBatchItem({
        batchItem,
        sweepRecord,
        parsedAttempts,
        provider,
        fetchTransactionReceipt,
      }));
    } catch (submissionError) {
      results.push({
        orderId: batchItem.orderId,
        sweepId: sweepRecord.id,
        status: SWEEP_BATCH_SUBMISSION_FAILED,
        message: submissionError.message,
      });
    }
  }

  return {
    batchId: signedBatch.batchId,
    submittedAt: new Date().toISOString(),
    results,
  };
}
