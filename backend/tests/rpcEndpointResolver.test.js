import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveBscRpcUrl,
  resolvePublicBscRpcUrlCandidates,
  isBscTestnetRpcUrl,
  resolveAlchemyBscRpcUrl,
  DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS,
  DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS,
} from '../services/rpcEndpointResolver.js';

const trackedEnvironmentNames = [
  'BSC_RPC_URL',
  'BSC_RPC_URL_FALLBACK_URLS',
  'ALCHEMY_RPC_URL',
  'ALCHEMY_API_KEY',
  'ALCHEMY_NETWORK',
];

const previousEnvironment = Object.fromEntries(
  trackedEnvironmentNames.map((environmentName) => [environmentName, process.env[environmentName]])
);

function applyEnvironment(environmentOverrides) {
  for (const [environmentName, environmentValue] of Object.entries(environmentOverrides)) {
    if (environmentValue === undefined) {
      delete process.env[environmentName];
    } else {
      process.env[environmentName] = environmentValue;
    }
  }
}

function withEnvironment(environmentOverrides, runAssertions) {
  applyEnvironment(environmentOverrides);
  try {
    return runAssertions();
  } finally {
    applyEnvironment(previousEnvironment);
  }
}

after(() => applyEnvironment(previousEnvironment));

test('an explicit BSC_RPC_URL always wins, so a testnet or local node can be pointed at', () => {
  withEnvironment(
    { BSC_RPC_URL: 'https://custom-bsc.example/rpc' },
    () => assert.equal(resolveBscRpcUrl(), 'https://custom-bsc.example/rpc')
  );
});

test('a testnet endpoint is detected from the url so the right defaults are used', () => {
  withEnvironment({ BSC_RPC_URL: 'https://bsc-testnet-rpc.publicnode.com' }, () => {
    assert.equal(isBscTestnetRpcUrl(process.env.BSC_RPC_URL), true);
    const candidateUrls = resolvePublicBscRpcUrlCandidates();
    assert.equal(candidateUrls[0], 'https://bsc-testnet-rpc.publicnode.com');
    assert.ok(
      candidateUrls.includes(DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS[0]),
      'the built-in testnet defaults are offered as fallbacks'
    );
  });
});

test("Binance's own seed endpoints stay excluded because they reject every eth_getLogs call", () => {
  // Probed directly: the listener's only chain call is eth_getLogs, and these
  // hosts answer basic RPC methods but refuse that one, so including them would
  // hand the pool a candidate that can never succeed.
  const bnbSeedEndpoints = [
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    'https://bsc-prebsc-dataseed.bnbchain.org:8545',
  ];

  for (const network of [56, 97]) {
    withEnvironment({ BSC_RPC_URL: 'https://bsc-rpc.publicnode.com' }, () => {
      const candidateUrls = resolvePublicBscRpcUrlCandidates();
      for (const seedEndpoint of bnbSeedEndpoints) {
        assert.equal(
          candidateUrls.includes(seedEndpoint),
          false,
          `${seedEndpoint} must not be a candidate (resolved for chain ${network})`
        );
      }
    });
  }
});

test('a mainnet endpoint falls back to mainnet defaults', () => {
  withEnvironment({ BSC_RPC_URL: 'https://bsc.publicnode.com' }, () => {
    const candidateUrls = resolvePublicBscRpcUrlCandidates();
    assert.equal(candidateUrls[0], 'https://bsc.publicnode.com');
    assert.ok(
      candidateUrls.includes(DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS[1]),
      'more than the configured endpoint is offered, so a throttled node has somewhere to rotate to'
    );
  });
});

test('with nothing configured the resolver still returns a usable public endpoint', () => {
  withEnvironment({ BSC_RPC_URL: undefined }, () => {
    const resolvedUrl = resolveBscRpcUrl();
    assert.ok(resolvedUrl.startsWith('http'));
    assert.ok(resolvePublicBscRpcUrlCandidates().length >= 2, 'more than one endpoint is available');
  });
});

test('the payment path never needs an Alchemy key, and the old resolver still reports its own error', () => {
  withEnvironment(
    { ALCHEMY_RPC_URL: undefined, ALCHEMY_API_KEY: undefined, BSC_RPC_URL: undefined },
    () => {
      assert.doesNotThrow(() => resolveBscRpcUrl());
      assert.throws(resolveAlchemyBscRpcUrl, /ALCHEMY_API_KEY is not configured/);
    }
  );
});

test('an Alchemy override is still honoured by the legacy resolver for the manual verify endpoint', () => {
  withEnvironment({ ALCHEMY_RPC_URL: 'https://bnb-testnet.g.alchemy.com/v2/legacy-key' }, () => {
    assert.equal(
      resolveAlchemyBscRpcUrl(),
      'https://bnb-testnet.g.alchemy.com/v2/legacy-key'
    );
  });
});
