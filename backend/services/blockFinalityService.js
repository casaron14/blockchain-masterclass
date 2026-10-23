import { ethers } from 'ethers';

export const DEFAULT_PROBABILISTIC_FINALITY_DEPTH = 15;

// BNB Smart Chain reaches deterministic finality in about a second through
// BEP-126 voting, and exposes it as the "finalized" block tag. Waiting a fixed
// number of confirmations is the pre-BEP-126 rule and only adds latency, so
// "finalized" is the default and the depth is only the fallback for a node
// that does not serve the tag.
export function resolveSettlementMode() {
  const configuredMode = (process.env.SETTLEMENT_FINALITY_MODE || 'finalized').toLowerCase();
  return configuredMode === 'depth' ? 'depth' : 'finalized';
}

export function resolveProbabilisticFinalityDepth() {
  const configuredDepth = Number(process.env.SETTLEMENT_MIN_CONFIRMATIONS);
  if (Number.isFinite(configuredDepth) && configuredDepth > 0) {
    return configuredDepth;
  }
  return DEFAULT_PROBABILISTIC_FINALITY_DEPTH;
}

export async function fetchLatestBlockNumber(provider) {
  return provider.getBlockNumber();
}

async function fetchBlockNumberForTag(provider, blockTag) {
  const blockHeader = await provider.send('eth_getBlockByNumber', [blockTag, false]);
  if (!blockHeader?.number) {
    return null;
  }
  return Number(BigInt(blockHeader.number));
}

// Returns the head of the chain and the head of the settled part of it, plus
// which signal produced it. Callers get one frontier per listener tick so every
// deposit in a tick is judged against the same settlement point.
export async function fetchChainSettlementFrontier(provider) {
  const latestBlockNumber = await fetchLatestBlockNumber(provider);

  if (resolveSettlementMode() === 'finalized') {
    for (const blockTag of ['finalized', 'safe']) {
      try {
        const taggedBlockNumber = await fetchBlockNumberForTag(provider, blockTag);
        if (taggedBlockNumber !== null && taggedBlockNumber <= latestBlockNumber) {
          return {
            latestBlockNumber,
            finalizedBlockNumber: taggedBlockNumber,
            settledBy: blockTag,
          };
        }
      } catch {
        continue;
      }
    }
  }

  const probabilisticDepth = resolveProbabilisticFinalityDepth();
  return {
    latestBlockNumber,
    finalizedBlockNumber: Math.max(0, latestBlockNumber - probabilisticDepth + 1),
    settledBy: 'depth',
    probabilisticDepth,
  };
}

export function countBlockConfirmations({ blockNumber, latestBlockNumber }) {
  return latestBlockNumber - blockNumber + 1;
}

// A deposit is money in the bank only when its block is at or below the settled
// head. Under the depth fallback the same comparison is made against a head
// pulled back by the required number of confirmations.
export function isBlockSettled({ blockNumber, finalizedBlockNumber, latestBlockNumber }) {
  if (blockNumber > latestBlockNumber) {
    return false;
  }
  return blockNumber <= finalizedBlockNumber;
}

export function buildSettlementReadinessDecision({
  observedAmountWei,
  expectedAmountWei,
  latestBlockNumber,
  finalizedBlockNumber,
  latestObservedBlockNumber,
  settledBy,
}) {
  if (BigInt(observedAmountWei) < BigInt(expectedAmountWei)) {
    return { ready: false, reason: 'AMOUNT_UNDERPAID' };
  }

  const confirmations = countBlockConfirmations({
    blockNumber: latestObservedBlockNumber,
    latestBlockNumber,
  });

  if (!isBlockSettled({
    blockNumber: latestObservedBlockNumber,
    finalizedBlockNumber,
    latestBlockNumber,
  })) {
    return { ready: false, reason: 'NOT_FINALIZED_YET', confirmations };
  }

  return {
    ready: true,
    reason: 'OK',
    confirmations,
    settledBy,
    finalizedBlockNumber,
  };
}

// A short reorg can replace a block that was read moments ago. The hash stored
// with the deposit is compared against the canonical block at the same height;
// a mismatch means the deposit we recorded is not on the chain any more.
export async function verifyObservedBlockIsStillCanonical(provider, blockNumber, expectedBlockHash) {
  if (!expectedBlockHash) {
    return true;
  }

  const blockHeader = await provider.getBlock(blockNumber);
  if (!blockHeader) {
    return false;
  }
  return String(blockHeader.hash).toLowerCase() === String(expectedBlockHash).toLowerCase();
}

export function normalizeDepositAddressForComparison(depositAddress) {
  return ethers.getAddress(depositAddress).toLowerCase();
}
