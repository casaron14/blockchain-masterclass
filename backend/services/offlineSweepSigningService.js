import { ethers } from 'ethers';

import { createDerivedWalletForDerivationIndex } from './signingService.js';

const USDT_TRANSFER_INTERFACE = new ethers.Interface([
  'function transfer(address to, uint256 value)',
]);

function normalizeAddress(address) {
  return String(address ?? '').toLowerCase();
}

function assertPreparedSweepAttemptMatchesBatchItem({
  batchItem,
  batchNetwork,
  unsignedTransaction,
  attempt,
}) {
  const expectedUsdtContractAddress = normalizeAddress(batchNetwork.usdtContractAddress);
  const expectedTreasuryAddress = normalizeAddress(batchNetwork.treasuryAddress);

  if (normalizeAddress(unsignedTransaction.to) !== expectedUsdtContractAddress) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} targets ${unsignedTransaction.to}, `
      + `not the configured USDT contract ${batchNetwork.usdtContractAddress}`
    );
  }
  if (String(unsignedTransaction.chainId) !== String(batchItem.chainId)) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} is for chain `
      + `${unsignedTransaction.chainId}, expected ${batchItem.chainId}`
    );
  }
  if (unsignedTransaction.nonce !== batchItem.nonce) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} uses nonce `
      + `${unsignedTransaction.nonce}, expected ${batchItem.nonce}`
    );
  }
  if (unsignedTransaction.gasPrice.toString() !== String(attempt.gasPriceWei)) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} has gas price `
      + `${unsignedTransaction.gasPrice}, expected ${attempt.gasPriceWei}`
    );
  }
  if (unsignedTransaction.gasLimit.toString() !== String(batchItem.gasLimit)) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} has gas limit `
      + `${unsignedTransaction.gasLimit}, expected ${batchItem.gasLimit}`
    );
  }
  if (unsignedTransaction.value !== 0n) {
    throw new Error(`Prepared sweep for order ${batchItem.orderId} must not send BNB`);
  }

  let decodedTransfer;
  try {
    decodedTransfer = USDT_TRANSFER_INTERFACE.parseTransaction({
      data: unsignedTransaction.data,
    });
  } catch {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} is not a USDT transfer`
    );
  }
  if (!decodedTransfer || decodedTransfer.name !== 'transfer') {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} is not a USDT transfer`
    );
  }
  if (normalizeAddress(decodedTransfer.args[0]) !== expectedTreasuryAddress) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} sends USDT to `
      + `${decodedTransfer.args[0]}, not the treasury ${batchNetwork.treasuryAddress}`
    );
  }
  if (decodedTransfer.args[1].toString() !== String(batchItem.amountWei)) {
    throw new Error(
      `Prepared sweep for order ${batchItem.orderId} sends `
      + `${decodedTransfer.args[1]}, expected ${batchItem.amountWei}`
    );
  }
}

function assertPreparedSweepBatchHasUsableShape(preparedBatch) {
  if (!preparedBatch || !Array.isArray(preparedBatch.items)) {
    throw new Error('Prepared sweep batch has no items array');
  }
  if (!preparedBatch.network || !preparedBatch.network.usdtContractAddress) {
    throw new Error('Prepared sweep batch has no network configuration');
  }
  for (const batchItem of preparedBatch.items) {
    if (!Array.isArray(batchItem.attempts) || batchItem.attempts.length === 0) {
      throw new Error(
        `Prepared sweep for order ${batchItem.orderId} has no unsigned attempts`
      );
    }
  }
}

/**
 * Runs on the air-gapped machine. It is the only place that reads
 * WALLET_MNEMONIC for collection, and it never talks to the network or the
 * database: it turns the prepared batch into raw signed transactions.
 *
 * Every attempt is checked against the batch before signing (destination
 * contract, treasury, amount, chain, nonce, gas price) and the recovered
 * sender is checked afterwards, so a corrupted batch cannot be signed and a
 * wrong key is caught before anything is broadcast.
 */
export async function signPreparedSweepBatchWithMasterMnemonic(
  preparedBatch,
  { deriveWallet = createDerivedWalletForDerivationIndex } = {}
) {
  assertPreparedSweepBatchHasUsableShape(preparedBatch);

  const signedItems = [];

  for (const batchItem of preparedBatch.items) {
    const derivedWallet = deriveWallet(batchItem.derivationIndex);
    if (normalizeAddress(derivedWallet.address) !== normalizeAddress(batchItem.depositAddress)) {
      throw new Error(
        `Derivation index ${batchItem.derivationIndex} produces ${derivedWallet.address}, `
        + `but the prepared batch expects ${batchItem.depositAddress}. `
        + 'The mnemonic and WALLET_ACCOUNT_XPUB do not belong to the same seed.'
      );
    }

    const signedAttempts = [];
    for (const attempt of batchItem.attempts) {
      const unsignedTransaction = ethers.Transaction.from(attempt.unsignedTransaction);
      assertPreparedSweepAttemptMatchesBatchItem({
        batchItem,
        batchNetwork: preparedBatch.network,
        unsignedTransaction,
        attempt,
      });

      const rawTransaction = await derivedWallet.signTransaction(unsignedTransaction);
      const signedTransaction = ethers.Transaction.from(rawTransaction);
      if (normalizeAddress(signedTransaction.from) !== normalizeAddress(batchItem.depositAddress)) {
        throw new Error(
          `Signed sweep for order ${batchItem.orderId} has sender `
          + `${signedTransaction.from}, expected ${batchItem.depositAddress}`
        );
      }

      signedAttempts.push({
        gasPriceWei: attempt.gasPriceWei,
        rawTransaction,
        transactionHash: signedTransaction.hash,
      });
    }

    signedItems.push({
      ...batchItem,
      attempts: signedAttempts,
    });
  }

  return {
    ...preparedBatch,
    signedAt: new Date().toISOString(),
    items: signedItems,
  };
}
