import { ethers } from 'ethers';

import {
  GAS_FUNDING_TRANSACTION_GAS_LIMIT,
  resolveGasWalletPrivateKey,
} from './gasWalletService.js';

function normalizeAddress(address) {
  return String(address ?? '').toLowerCase();
}

function assertPreparedGasFundingMatchesBatchItem({
  batchItem,
  gasFundingTransaction,
}) {
  if (normalizeAddress(gasFundingTransaction.to) !== normalizeAddress(batchItem.depositAddress)) {
    throw new Error(
      `Gas funding for order ${batchItem.orderId} sends BNB to `
      + `${gasFundingTransaction.to}, not the deposit address ${batchItem.depositAddress}`
    );
  }
  if (String(gasFundingTransaction.chainId) !== String(batchItem.chainId)) {
    throw new Error(
      `Gas funding for order ${batchItem.orderId} is for chain `
      + `${gasFundingTransaction.chainId}, expected ${batchItem.chainId}`
    );
  }
  if (gasFundingTransaction.data !== '0x' || gasFundingTransaction.value === 0n) {
    throw new Error(
      `Gas funding for order ${batchItem.orderId} is not a plain BNB transfer`
    );
  }
  if (gasFundingTransaction.gasLimit.toString() !== String(GAS_FUNDING_TRANSACTION_GAS_LIMIT)) {
    throw new Error(
      `Gas funding for order ${batchItem.orderId} has gas limit `
      + `${gasFundingTransaction.gasLimit}, expected ${GAS_FUNDING_TRANSACTION_GAS_LIMIT}`
    );
  }
}

/**
 * Runs on the air-gapped machine, like the sweep signer, and for the same
 * reason: this is the only key that can move BNB to a deposit address, so it
 * never lives on the public host.
 *
 * The transaction is rebuilt from the prepared fields rather than signed as
 * given, so every value that decides where the BNB goes is checked here and the
 * recovered sender is checked against the batch network afterwards.
 */
export async function signGasFundingTransactionWithOfflineGasWalletKey({
  batchItem,
  batchNetwork,
}) {
  if (!batchItem.gasFunding) {
    return null;
  }

  const gasWallet = new ethers.Wallet(resolveGasWalletPrivateKey());
  if (batchNetwork.gasWalletAddress
    && normalizeAddress(gasWallet.address) !== normalizeAddress(batchNetwork.gasWalletAddress)) {
    throw new Error(
      `GAS_WALLET_PRIVATE_KEY produces ${gasWallet.address}, but the prepared batch `
      + `expects the gas wallet ${batchNetwork.gasWalletAddress}`
    );
  }

  const unsignedGasFundingTransaction = ethers.Transaction.from({
    type: 0,
    chainId: batchItem.gasFunding.chainId,
    nonce: batchItem.gasFunding.nonce,
    to: batchItem.gasFunding.to,
    value: BigInt(batchItem.gasFunding.valueWei),
    gasLimit: batchItem.gasFunding.gasLimit,
    gasPrice: BigInt(batchItem.gasFunding.gasPriceWei),
    data: '0x',
  });

  assertPreparedGasFundingMatchesBatchItem({
    batchItem,
    gasFundingTransaction: unsignedGasFundingTransaction,
  });

  const rawTransaction = await gasWallet.signTransaction(unsignedGasFundingTransaction);
  const signedGasFundingTransaction = ethers.Transaction.from(rawTransaction);

  if (normalizeAddress(signedGasFundingTransaction.from) !== normalizeAddress(gasWallet.address)) {
    throw new Error(
      `Signed gas funding for order ${batchItem.orderId} has sender `
      + `${signedGasFundingTransaction.from}, expected ${gasWallet.address}`
    );
  }

  return {
    ...batchItem.gasFunding,
    from: gasWallet.address,
    rawTransaction,
    transactionHash: signedGasFundingTransaction.hash,
  };
}
