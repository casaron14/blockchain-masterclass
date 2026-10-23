import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchChainSettlementFrontier,
  isBlockSettled,
  countBlockConfirmations,
  buildSettlementReadinessDecision,
  verifyObservedBlockIsStillCanonical,
  resolveProbabilisticFinalityDepth,
  resolveSettlementMode,
} from '../services/blockFinalityService.js';

const previousEnvironment = {
  SETTLEMENT_FINALITY_MODE: process.env.SETTLEMENT_FINALITY_MODE,
  SETTLEMENT_MIN_CONFIRMATIONS: process.env.SETTLEMENT_MIN_CONFIRMATIONS,
};

function applyEnvironment(overrides) {
  for (const [environmentName, environmentValue] of Object.entries(overrides)) {
    if (environmentValue === undefined) {
      delete process.env[environmentName];
    } else {
      process.env[environmentName] = environmentValue;
    }
  }
}

function buildProviderReportingBlockNumbers(blockNumberByTag) {
  return {
    async getBlockNumber() {
      return Number(blockNumberByTag.latest);
    },
    async send(method, params) {
      if (method !== 'eth_getBlockByNumber') {
        throw new Error(`unexpected method ${method}`);
      }
      const requestedTag = params[0];
      if (requestedTag === 'latest') {
        return { number: `0x${Number(blockNumberByTag.latest).toString(16)}` };
      }
      if (blockNumberByTag[requestedTag] === undefined) {
        throw new Error(`tag ${requestedTag} not served`);
      }
      return { number: `0x${Number(blockNumberByTag[requestedTag]).toString(16)}` };
    },
  };
}

after(() => {
  applyEnvironment(previousEnvironment);
});

test('settlement uses the finalized block tag when the node serves it', async () => {
  applyEnvironment({ SETTLEMENT_FINALITY_MODE: 'finalized' });
  assert.equal(resolveSettlementMode(), 'finalized');

  const settlementFrontier = await fetchChainSettlementFrontier(
    buildProviderReportingBlockNumbers({ latest: 1000, finalized: 998, safe: 999 })
  );

  assert.equal(settlementFrontier.latestBlockNumber, 1000);
  assert.equal(settlementFrontier.finalizedBlockNumber, 998);
  assert.equal(settlementFrontier.settledBy, 'finalized');
});

test('settlement falls back to the safe tag when finalized is not served', async () => {
  applyEnvironment({ SETTLEMENT_FINALITY_MODE: 'finalized' });

  const settlementFrontier = await fetchChainSettlementFrontier(
    buildProviderReportingBlockNumbers({ latest: 1000, safe: 997 })
  );

  assert.equal(settlementFrontier.finalizedBlockNumber, 997);
  assert.equal(settlementFrontier.settledBy, 'safe');
});

test('settlement falls back to a confirmation depth when the node serves no tag', async () => {
  applyEnvironment({
    SETTLEMENT_FINALITY_MODE: 'finalized',
    SETTLEMENT_MIN_CONFIRMATIONS: '15',
  });
  assert.equal(resolveProbabilisticFinalityDepth(), 15);

  const settlementFrontier = await fetchChainSettlementFrontier(
    buildProviderReportingBlockNumbers({ latest: 1000 })
  );

  assert.equal(settlementFrontier.settledBy, 'depth');
  assert.equal(settlementFrontier.finalizedBlockNumber, 986);
});

test('depth mode never consults a block tag', async () => {
  applyEnvironment({ SETTLEMENT_FINALITY_MODE: 'depth', SETTLEMENT_MIN_CONFIRMATIONS: '5' });

  const settlementFrontier = await fetchChainSettlementFrontier(
    buildProviderReportingBlockNumbers({ latest: 100, finalized: 100, safe: 100 })
  );

  assert.equal(settlementFrontier.settledBy, 'depth');
  assert.equal(settlementFrontier.finalizedBlockNumber, 96);
});

test('a block at or below the settled head is settled, a block above it is not', () => {
  assert.equal(
    isBlockSettled({ blockNumber: 998, finalizedBlockNumber: 998, latestBlockNumber: 1000 }),
    true
  );
  assert.equal(
    isBlockSettled({ blockNumber: 999, finalizedBlockNumber: 998, latestBlockNumber: 1000 }),
    false
  );
});

test('confirmations are counted from the chain head', () => {
  assert.equal(countBlockConfirmations({ blockNumber: 1000, latestBlockNumber: 1000 }), 1);
  assert.equal(countBlockConfirmations({ blockNumber: 995, latestBlockNumber: 1000 }), 6);
});

test('a complete but unfinalized payment waits instead of confirming', () => {
  const readinessDecision = buildSettlementReadinessDecision({
    observedAmountWei: 3_800_000_000_000_000_000n,
    expectedAmountWei: 3_800_000_000_000_000_000n,
    latestBlockNumber: 1000,
    finalizedBlockNumber: 998,
    latestObservedBlockNumber: 1000,
    settledBy: 'finalized',
  });

  assert.equal(readinessDecision.ready, false);
  assert.equal(readinessDecision.reason, 'NOT_FINALIZED_YET');
  assert.equal(readinessDecision.confirmations, 1);
});

test('a short payment is rejected on amount even after it is finalized', () => {
  const readinessDecision = buildSettlementReadinessDecision({
    observedAmountWei: 1_900_000_000_000_000_000n,
    expectedAmountWei: 3_800_000_000_000_000_000n,
    latestBlockNumber: 1000,
    finalizedBlockNumber: 1000,
    latestObservedBlockNumber: 1000,
    settledBy: 'finalized',
  });

  assert.equal(readinessDecision.ready, false);
  assert.equal(readinessDecision.reason, 'AMOUNT_UNDERPAID');
});

test('a settled complete payment is ready', () => {
  const readinessDecision = buildSettlementReadinessDecision({
    observedAmountWei: 3_800_000_000_000_000_000n,
    expectedAmountWei: 3_800_000_000_000_000_000n,
    latestBlockNumber: 1000,
    finalizedBlockNumber: 1000,
    latestObservedBlockNumber: 1000,
    settledBy: 'finalized',
  });

  assert.equal(readinessDecision.ready, true);
  assert.equal(readinessDecision.reason, 'OK');
  assert.equal(readinessDecision.confirmations, 1);
});

test('a split payment is only ready when the exact total is reached', () => {
  const readinessArguments = {
    expectedAmountWei: 3_800_000_000_000_000_000n,
    latestBlockNumber: 1000,
    finalizedBlockNumber: 1000,
    latestObservedBlockNumber: 1000,
    settledBy: 'finalized',
  };

  const partialDecision = buildSettlementReadinessDecision({
    ...readinessArguments,
    observedAmountWei: 3_799_999_999_999_999_999n,
  });
  assert.equal(partialDecision.ready, false);

  const exactDecision = buildSettlementReadinessDecision({
    ...readinessArguments,
    observedAmountWei: 3_800_000_000_000_000_000n,
  });
  assert.equal(exactDecision.ready, true);
});

test('a stored block hash that no longer matches the canonical block is rejected', async () => {
  const providerWithReplacedBlock = {
    async getBlock() {
      return { hash: '0xreplacementhash' };
    },
  };

  assert.equal(
    await verifyObservedBlockIsStillCanonical(providerWithReplacedBlock, 900, '0xorphanedhash'),
    false
  );
  assert.equal(
    await verifyObservedBlockIsStillCanonical(providerWithReplacedBlock, 900, '0xREPLACEMENTHASH'),
    true
  );
});

test('a deposit with no stored block hash is never treated as reorged', async () => {
  const providerThatWouldFail = {
    async getBlock() {
      throw new Error('should not be called');
    },
  };

  assert.equal(await verifyObservedBlockIsStillCanonical(providerThatWouldFail, 900, null), true);
});
