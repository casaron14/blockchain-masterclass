// RPC endpoint selection for the backend.
//
// The payment listener reads the token contract with standard eth_getLogs, so
// it must not depend on a provider-specific indexing API: no Alchemy key is
// required to run this project.
//
// Only endpoints that actually serve a RECENT eth_getLogs range for the real
// USDT contract are listed. Each entry below was probed against a 50-block
// window ending at the chain tip:
//
//   mainnet - bsc.publicnode.com and 1rpc.io/bnb both returned USDT Transfer
//             logs on every attempt. bsc-rpc.publicnode.com served most
//             attempts but intermittently refused with "block range extends
//             beyond the last 10000 blocks" when the listener's look-back
//             window is wider than the tip it advertised.
//   testnet - bnb-testnet.api.onfinality.io served every attempt;
//             bsc-testnet.publicnode.com served most but is throttled
//             aggressively from shared IPs.
//
// Deliberately NOT listed:
//   data-seed-prebsc-*.bnbchain.org - reject eth_getLogs outright (see above),
//     so the listener cannot use them at all.
//   bsc.drpc.org / bsc-testnet.drpc.org - the free plan answers eth_blockNumber
//     but time out or return "Temporary internal error" on eth_getLogs.
//   binance.llamarpc.com - not reachable.
//
// Binance's own endpoints appear in no list, because the one call the listener
// depends on is exactly the one they refuse. The pool still rotates across
// every entry on failure, so a node that starts refusing logs costs one
// skipped tick, not a stalled listener: the scan cursor is only advanced after
// a successful scan, and the next tick re-reads an overlapping window.

export const BNB_SMART_CHAIN_TESTNET_RPC_URL =
  'https://bnb-testnet.api.onfinality.io/public';

export const DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS = Object.freeze([
  'https://bsc.publicnode.com',
  'https://1rpc.io/bnb',
  'https://bsc-rpc.publicnode.com',
  'https://bsc.blockrazor.xyz',
]);

export const DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS = Object.freeze([
  'https://bnb-testnet.api.onfinality.io/public',
  'https://bsc-testnet.publicnode.com',
  'https://bsc-testnet-rpc.publicnode.com',
]);

const BSC_TESTNET_RPC_URL_MARKERS = ['testnet', 'prebsc', 'chapel'];

export function isBscTestnetRpcUrl(rpcUrl) {
  const normalizedRpcUrl = String(rpcUrl || '').toLowerCase();
  return BSC_TESTNET_RPC_URL_MARKERS.some((marker) => normalizedRpcUrl.includes(marker));
}

export function resolvePublicBscRpcUrlCandidates() {
  const configuredUrls = (process.env.BSC_RPC_URL_FALLBACK_URLS || '')
    .split(',')
    .map((candidateUrl) => candidateUrl.trim())
    .filter(Boolean);

  const primaryUrl = resolveBscRpcUrl();
  const defaultUrls = isBscTestnetRpcUrl(primaryUrl)
    ? DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS
    : DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS;

  const orderedCandidates = [];
  for (const candidateUrl of [primaryUrl, ...configuredUrls, ...defaultUrls]) {
    if (candidateUrl && !orderedCandidates.includes(candidateUrl)) {
      orderedCandidates.push(candidateUrl);
    }
  }
  return orderedCandidates;
}

// Kept for callers that still read a value from the environment, and because
// the existing test suite covers its precedence rules. Nothing in the payment
// path calls it any more: the listener uses eth_getLogs against the pool above.
export function resolveAlchemyBscRpcUrl() {
  const configuredUrl = process.env.ALCHEMY_RPC_URL;
  if (configuredUrl) {
    return configuredUrl;
  }
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    throw new Error('ALCHEMY_API_KEY is not configured');
  }
  const alchemyNetwork = process.env.ALCHEMY_NETWORK || 'bnb-mainnet';
  return `https://${alchemyNetwork}.g.alchemy.com/v2/${alchemyApiKey}`;
}

export function resolveBscRpcUrl() {
  if (process.env.BSC_RPC_URL) {
    return process.env.BSC_RPC_URL;
  }
  const defaultUrls = isBscTestnetRpcUrl(process.env.ALCHEMY_RPC_URL)
    ? DEFAULT_PUBLIC_BSC_TESTNET_RPC_URLS
    : DEFAULT_PUBLIC_BSC_MAINNET_RPC_URLS;
  return defaultUrls[0];
}
