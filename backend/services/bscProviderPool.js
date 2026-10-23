import { ethers } from 'ethers';

import { resolveBscRpcUrl, resolvePublicBscRpcUrlCandidates } from './rpcEndpointResolver.js';

// A public RPC node rate-limits aggressively, and the listener polls every few
// seconds, so a single endpoint is a single point of failure: the observed
// symptom is a monitor that quietly stops seeing deposits. The pool keeps an
// ordered list of usable endpoints, hands out the active one, and rotates to
// the next candidate when a request fails. Rotation is sticky (the endpoint
// that worked keeps being used) and a failed endpoint is parked for a cool-down
// so a rate-limited node is not hammered in a tight loop.
export const DEFAULT_ENDPOINT_COOL_DOWN_MS = 60_000;

export class BscProviderPool {
  constructor(candidateUrls, { coolDownMs = DEFAULT_ENDPOINT_COOL_DOWN_MS } = {}) {
    this.candidateUrls = [...candidateUrls];
    this.coolDownMs = coolDownMs;
    this.activeIndex = 0;
    this.failuresByIndex = new Map();
    this.parkedUntilByIndex = new Map();
    if (this.candidateUrls.length === 0) {
      throw new Error('BscProviderPool requires at least one candidate RPC url');
    }
  }

  getActiveCandidateUrl() {
    const now = Date.now();
    const parkedUntil = this.parkedUntilByIndex.get(this.activeIndex) ?? 0;
    if (parkedUntil > now) {
      this.rotateToNextReachableCandidate(now);
    }
    return this.candidateUrls[this.activeIndex];
  }

  markActiveCandidateAsFailed(error) {
    const failedIndex = this.activeIndex;
    this.failuresByIndex.set(failedIndex, (this.failuresByIndex.get(failedIndex) ?? 0) + 1);
    this.parkedUntilByIndex.set(failedIndex, Date.now() + this.coolDownMs);
    this.rotateToNextReachableCandidate(Date.now());
    return error;
  }

  markActiveCandidateAsHealthy() {
    this.failuresByIndex.set(this.activeIndex, 0);
  }

  getFailureCountForActiveCandidate() {
    return this.failuresByIndex.get(this.activeIndex) ?? 0;
  }

  rotateToNextReachableCandidate(now) {
    for (let offset = 1; offset <= this.candidateUrls.length; offset += 1) {
      const candidateIndex = (this.activeIndex + offset) % this.candidateUrls.length;
      const parkedUntil = this.parkedUntilByIndex.get(candidateIndex) ?? 0;
      if (parkedUntil <= now) {
        this.activeIndex = candidateIndex;
        return;
      }
    }
    return;
  }
}

export function createBscProviderPool({ candidateUrls, coolDownMs } = {}) {
  const resolvedCandidateUrls = candidateUrls?.length
    ? candidateUrls
    : resolvePublicBscRpcUrlCandidates();

  return new BscProviderPool(resolvedCandidateUrls, { coolDownMs });
}

export function createBscJsonRpcProvider(rpcUrl = resolveBscRpcUrl()) {
  return new ethers.JsonRpcProvider(rpcUrl);
}
