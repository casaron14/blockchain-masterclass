import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BscProviderPool, createBscProviderPool } from '../services/bscProviderPool.js';
import {
  createSharedBscProviderPool,
  resetSharedBscProviderPoolForTesting,
  runPaymentMonitorJob,
} from '../jobs/paymentMonitorJob.js';
// Assigning undefined to a process.env key stores the string "undefined", which
// would silently poison the endpoint resolution for every later test.
async function withRpcEnvironment(environmentOverrides, runAssertions) {
  const previousEnvironment = {};
  for (const [environmentName, environmentValue] of Object.entries(environmentOverrides)) {
    previousEnvironment[environmentName] = process.env[environmentName];
    process.env[environmentName] = environmentValue;
  }
  try {
    return await runAssertions();
  } finally {
    for (const [environmentName, environmentValue] of Object.entries(previousEnvironment)) {
      if (environmentValue === undefined) {
        delete process.env[environmentName];
      } else {
        process.env[environmentName] = environmentValue;
      }
    }
  }
}

import {
  isBscTestnetRpcUrl,
  resolvePublicBscRpcUrlCandidates,
  DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS,
  DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS,
} from '../services/rpcEndpointResolver.js';

test('the active endpoint stays in use while it keeps working', () => {
  const providerPool = new BscProviderPool(['https://first.example', 'https://second.example']);

  providerPool.markActiveCandidateAsHealthy();
  assert.equal(providerPool.getActiveCandidateUrl(), 'https://first.example');
  assert.equal(providerPool.getActiveCandidateUrl(), 'https://first.example');
});

test('a failing endpoint is rotated away from so the listener keeps seeing deposits', () => {
  const providerPool = new BscProviderPool(['https://first.example', 'https://second.example']);

  const rateLimitError = new Error('Rate limit exceeded');
  providerPool.markActiveCandidateAsFailed(rateLimitError);

  assert.equal(providerPool.getActiveCandidateUrl(), 'https://second.example');
  assert.equal(providerPool.getFailureCountForActiveCandidate(), 0);
});

test('every endpoint failing still leaves a usable candidate', () => {
  const providerPool = new BscProviderPool(['https://only.example']);

  providerPool.markActiveCandidateAsFailed(new Error('timeout'));

  assert.equal(providerPool.getActiveCandidateUrl(), 'https://only.example');
});

test('when every endpoint is cooling down the pool keeps the current one instead of spinning', () => {
  const providerPool = new BscProviderPool(['https://first.example', 'https://second.example'], {
    coolDownMs: 60_000,
  });

  providerPool.markActiveCandidateAsFailed(new Error('Rate limit exceeded'));
  assert.equal(providerPool.getActiveCandidateUrl(), 'https://second.example');

  providerPool.markActiveCandidateAsFailed(new Error('Rate limit exceeded'));
  assert.equal(
    providerPool.getActiveCandidateUrl(),
    'https://second.example',
    'a rate limited endpoint is not retried while every alternative is also cooling down'
  );
});

test('an empty candidate list is rejected instead of failing at request time', () => {
  assert.throws(() => new BscProviderPool([]), /at least one candidate RPC url/);
});

test('a testnet RPC url is recognised as testnet', () => {
  assert.equal(isBscTestnetRpcUrl('https://bsc-testnet-rpc.publicnode.com'), true);
  assert.equal(isBscTestnetRpcUrl('https://bsc-prebsc-dataseed.bnbchain.org:8545'), true);
  assert.equal(isBscTestnetRpcUrl('https://bsc-rpc.publicnode.com'), false);
});

test('the candidate list starts with the configured endpoint and has no duplicates', () => {
  withRpcEnvironment(
    {
      BSC_RPC_URL: 'https://bsc-testnet-rpc.publicnode.com',
      BSC_RPC_URL_FALLBACK_URLS:
        'https://bsc-testnet.drpc.org,https://bsc-testnet-rpc.publicnode.com',
    },
    () => {
      const candidateUrls = resolvePublicBscRpcUrlCandidates();

      assert.equal(candidateUrls[0], 'https://bsc-testnet-rpc.publicnode.com');
      assert.equal(candidateUrls[1], 'https://bsc-testnet.drpc.org');
      assert.equal(new Set(candidateUrls).size, candidateUrls.length);
      assert.ok(candidateUrls.length >= 3, 'built-in testnet fallbacks are included');
    }
  );
});

test('a pool can be created from the configured environment', () => {
  const providerPool = createBscProviderPool();
  assert.ok(providerPool.getActiveCandidateUrl().startsWith('http'));
});

// Drives the real job so the assertion covers the wiring, not just the helper:
// a pool built inside the tick is thrown away, and the next tick would start on
// the throttled endpoint again.
// The exact production shape that made the listener hammer one dead URL:
// CHAIN_ID unset, so the tick asks the node which network it is on before any
// other call. That request goes over the same throttled endpoint, so the tick
// has to report the failure to the pool or it never rotates away.
test('a throttled node is rotated away even when the chain id has to be read from it', async () => {
  const preferredTestnetUrl = 'https://first.testnet.example';

  await withRpcEnvironment(
    {
      BSC_RPC_URL: preferredTestnetUrl,
      BSC_RPC_URL_FALLBACK_URLS: 'https://second.testnet.example',
      CHAIN_ID: undefined,
    },
    async () => {
      resetSharedBscProviderPoolForTesting();

      try {
        const throttledProvider = {
          async getNetwork() {
            throw new Error('429 Too Many Requests');
          },
          async getBlockNumber() {
            throw new Error('429 Too Many Requests');
          },
        };

        const failedTick = await runPaymentMonitorJob({ provider: throttledProvider });
        assert.equal(failedTick.failed, true);

        assert.equal(
          createSharedBscProviderPool().getActiveCandidateUrl(),
          'https://second.testnet.example',
          'a failure while reading the network must rotate the endpoint, not repeat forever'
        );
      } finally {
        resetSharedBscProviderPoolForTesting();
      }
    }
  );
});

test('runPaymentMonitorJob keeps a rate-limited endpoint parked for later ticks', async () => {
  const preferredTestnetUrl = 'https://first.testnet.example';

  await withRpcEnvironment(
    {
      BSC_RPC_URL: preferredTestnetUrl,
      BSC_RPC_URL_FALLBACK_URLS: 'https://second.testnet.example',
      CHAIN_ID: '97',
    },
    async () => {
      resetSharedBscProviderPoolForTesting();

      try {
        assert.equal(createSharedBscProviderPool().getActiveCandidateUrl(), preferredTestnetUrl);

        // A provider whose first chain read fails stands in for a throttled
        // node; the tick marks the active candidate as failed and rethrows.
        const rateLimitedProvider = {
          async getBlockNumber() {
            throw new Error('Rate limit exceeded');
          },
        };

        const failedTick = await runPaymentMonitorJob({
          provider: rateLimitedProvider,
          chainId: 97,
        });
        assert.equal(failedTick.failed, true);

        assert.equal(
          createSharedBscProviderPool().getActiveCandidateUrl(),
          'https://second.testnet.example',
          'the rate-limited endpoint stays parked instead of being retried on the next tick'
        );
      } finally {
        resetSharedBscProviderPoolForTesting();
      }
    }
  );
});

test('consecutive listener ticks share one pool so a throttled endpoint stays parked', async () => {
  const preferredTestnetUrl = 'https://first.testnet.example';
  const fallbackTestnetUrl = 'https://second.testnet.example';

  withRpcEnvironment(
    {
      BSC_RPC_URL: preferredTestnetUrl,
      BSC_RPC_URL_FALLBACK_URLS: fallbackTestnetUrl,
      CHAIN_ID: '97',
    },
    async () => {
      resetSharedBscProviderPoolForTesting();

      try {
        const firstTickPool = createSharedBscProviderPool();
        assert.equal(
          firstTickPool.getActiveCandidateUrl(),
          preferredTestnetUrl,
          'the first tick starts on the configured endpoint'
        );

        // Every tick is handed the SAME pool instance, so the rotation and the
        // cool-down recorded by one tick are visible to the next one. Building
        // the pool inside the tick instead threw this away and reset the
        // listener onto the throttled endpoint every 5 seconds.
        const secondTickPool = createSharedBscProviderPool();
        assert.equal(secondTickPool, firstTickPool, 'the pool identity is reused');

        firstTickPool.markActiveCandidateAsFailed(new Error('Rate limit exceeded'));

        const thirdTickPool = createSharedBscProviderPool();
        assert.equal(
          thirdTickPool.getActiveCandidateUrl(),
          fallbackTestnetUrl,
          'a later tick starts on the fallback, not back on the rate-limited endpoint'
        );
        assert.equal(
          createSharedBscProviderPool().getActiveCandidateUrl(),
          fallbackTestnetUrl,
          'the rotation survives further ticks instead of resetting to the first candidate'
        );
      } finally {
        resetSharedBscProviderPoolForTesting();
      }
    }
  );
});

test('the built-in candidate lists contain no duplicates and no endpoint that refuses eth_getLogs', () => {
  for (const candidateList of [DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS, DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS]) {
    assert.equal(
      new Set(candidateList).size,
      candidateList.length,
      'a duplicated endpoint would waste a slot that exists to provide failover'
    );

    assert.equal(
      candidateList.some((candidateUrl) => /bnbchain\.org|data-seed-prebsc/.test(candidateUrl)),
      false,
      `Binance endpoints reject eth_getLogs, which the listener requires: ${candidateList.join(', ')}`
    );

    assert.equal(
      candidateList.some((candidateUrl) => /drpc\.org/.test(candidateUrl)),
      false,
      `the free drpc plan times out on eth_getLogs: ${candidateList.join(', ')}`
    );
  }
});

test('a fresh pool falls back to the mainnet list when the configured endpoint is a mainnet url', () => {
  withRpcEnvironment(
    { BSC_RPC_URL: 'https://bsc.publicnode.com', BSC_RPC_URL_FALLBACK_URLS: '' },
    () => {
      assert.deepEqual(resolvePublicBscRpcUrlCandidates(), DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS);
    }
  );
});
