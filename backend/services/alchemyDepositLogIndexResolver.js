import { logWarning } from '../utils/applicationLogger.js';

import {
  createUsdtProvider,
  getUsdtContractAddress,
  parseAllUsdtTransfersFromReceipt,
} from './usdtPaymentService.js';

// Alchemy's Address Activity payload does not always contain the Transfer log
// index, and a deposit is identified by (tx_hash, log_index). Defaulting to 0
// would collide with the real first log of the same transaction, so a missing
// index is read from the transaction receipt instead.
//
// A transfer that cannot be matched to exactly one log is dropped from this
// fast path: the polling listener reads the same block window from
// eth_getLogs and records every log there, so dropping here loses no deposit.
function findSingleMatchingUsdtTransferInReceipt(
  transactionReceipt,
  parsedTransfer,
  usdtContractAddress
) {
  const matchingTransfers = parseAllUsdtTransfersFromReceipt(
    transactionReceipt,
    usdtContractAddress
  ).filter(
    (receiptTransfer) =>
      String(receiptTransfer.toAddress).toLowerCase()
        === String(parsedTransfer.toAddress).toLowerCase()
      && receiptTransfer.value === parsedTransfer.amountWei
      && (
        !parsedTransfer.fromAddress
        || String(receiptTransfer.fromAddress).toLowerCase()
          === String(parsedTransfer.fromAddress).toLowerCase()
      )
  );

  // Two identical transfers in one transaction cannot be told apart from the
  // webhook payload alone, so neither is picked here.
  return matchingTransfers.length === 1 ? matchingTransfers[0] : null;
}

export async function resolveMissingAlchemyTransferLogIndexes(
  parsedTransfers,
  provider = null
) {
  const transfersMissingLogIndex = parsedTransfers.filter(
    (parsedTransfer) => parsedTransfer.logIndex === null
  );
  if (transfersMissingLogIndex.length === 0) {
    return parsedTransfers;
  }

  let activeProvider;
  try {
    activeProvider = provider ?? createUsdtProvider();
  } catch (providerError) {
    logWarning('alchemy_deposit_log_index_provider_unavailable', {
      errorMessage: providerError.message,
    });
    return parsedTransfers.filter((parsedTransfer) => parsedTransfer.logIndex !== null);
  }

  const transactionReceiptByTxHash = new Map();
  const resolvedTransfers = [];

  for (const parsedTransfer of parsedTransfers) {
    if (parsedTransfer.logIndex !== null) {
      resolvedTransfers.push(parsedTransfer);
      continue;
    }

    let transactionReceipt = transactionReceiptByTxHash.get(parsedTransfer.txHash);
    if (transactionReceipt === undefined) {
      try {
        transactionReceipt = await activeProvider.getTransactionReceipt(parsedTransfer.txHash);
      } catch (receiptError) {
        // The node may not have the transaction yet, or the RPC may be down.
        // Skipping keeps the webhook acknowledged; the polling scan backfills.
        logWarning('alchemy_deposit_log_index_receipt_unavailable', {
          txHash: parsedTransfer.txHash,
          errorMessage: receiptError.message,
        });
        transactionReceipt = null;
      }
      transactionReceiptByTxHash.set(parsedTransfer.txHash, transactionReceipt);
    }

    if (!transactionReceipt) {
      continue;
    }

    const matchingTransfer = findSingleMatchingUsdtTransferInReceipt(
      transactionReceipt,
      parsedTransfer,
      getUsdtContractAddress()
    );
    if (!matchingTransfer) {
      logWarning('alchemy_deposit_log_index_unresolved', {
        txHash: parsedTransfer.txHash,
        toAddress: parsedTransfer.toAddress,
      });
      continue;
    }

    resolvedTransfers.push({
      ...parsedTransfer,
      logIndex: matchingTransfer.logIndex,
      // The receipt carries the block hash the reorg guard needs, which the
      // webhook payload never does.
      blockHash: transactionReceipt.blockHash ?? null,
      blockNumber: Number(transactionReceipt.blockNumber ?? parsedTransfer.blockNumber),
    });
  }

  return resolvedTransfers;
}
