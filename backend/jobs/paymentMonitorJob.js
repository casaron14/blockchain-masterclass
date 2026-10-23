import { runUsdtTransferListenerTick } from '../services/monitorService.js';
import { createBscProviderPool } from '../services/bscProviderPool.js';

// The endpoint pool MUST outlive a single tick.
//
// A public RPC node rate-limits per IP, and the listener polls every few
// seconds, so the active endpoint is expected to fail regularly. The pool
// holds two pieces of state that only help if they survive: the index of the
// endpoint currently in use, and the cool-down until which a rate-limited
// endpoint is parked. Building the pool inside runUsdtTransferListenerTick
// discarded both on every tick, so each tick restarted at the first candidate
// and rotated to the second the instant it was throttled - the remaining
// candidates were never used and the cool-down never took effect.
//
// One pool is therefore created lazily here, on first use, and reused by every
// subsequent tick for the life of the process.
let sharedBscProviderPool = null;

export function createSharedBscProviderPool() {
  if (!sharedBscProviderPool) {
    sharedBscProviderPool = createBscProviderPool();
  }
  return sharedBscProviderPool;
}

// Exposed for the test suite so a test can start from a clean pool without
// leaking its state into other tests in the same process.
export function resetSharedBscProviderPoolForTesting() {
  sharedBscProviderPool = null;
}

// The listener tick is a single pass: discover transfers, record them, settle
// what is settled. Errors are logged and swallowed here because the job runs on
// a timer, and a thrown rejection would only surface as an unhandled rejection
// while the next tick still has to happen.
export async function runPaymentMonitorJob({ provider, providerPool, chainId } = {}) {
  // An injected pool wins (that is how the tests and the retry job drive it);
  // otherwise every tick shares one pool so rotation and cool-down accumulate.
  const activeProviderPool = providerPool ?? createSharedBscProviderPool();

  try {
    const tickSummary = await runUsdtTransferListenerTick({
      provider,
      providerPool: activeProviderPool,
      chainId,
    });

    if (tickSummary.confirmedCount > 0) {
      console.log(
        `Usdt listener confirmed ${tickSummary.confirmedCount} payment(s) between blocks ${tickSummary.scannedFromBlock} and ${tickSummary.scannedToBlock}`
      );
    }

    return tickSummary;
  } catch (error) {
    console.error('Usdt listener tick failed', error.message);
    return { failed: true, reason: error.message };
  }
}