import { ethers } from 'ethers';
import pool from '../config/db.js';

export const DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP = '0.005';
export const DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE = '0.05';
export const DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_DAY = '0.2';
export const DEFAULT_GAS_SPONSORSHIP_SPEND_WINDOW_HOURS = 24;

export const GAS_SPONSORSHIP_WITHIN_LIMITS = 'WITHIN_SPONSORSHIP_LIMITS';
export const GAS_SPONSORSHIP_NOT_REQUIRED = 'NO_SPONSORSHIP_REQUIRED';
export const GAS_SPONSORSHIP_PER_SWEEP_LIMIT_EXCEEDED = 'PER_SWEEP_LIMIT_EXCEEDED';
export const GAS_SPONSORSHIP_PER_CYCLE_LIMIT_EXCEEDED = 'PER_CYCLE_LIMIT_EXCEEDED';
export const GAS_SPONSORSHIP_DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED';

export class GasSponsorshipLimitExceededError extends Error {
  constructor(refusalMessage, sponsorshipDecision) {
    super(refusalMessage);
    this.name = 'GasSponsorshipLimitExceededError';
    this.reason = sponsorshipDecision.reason;
    this.sponsorshipDecision = sponsorshipDecision;
  }
}

function parseBnbLimitWei(variableName, configuredValue, defaultValue) {
  const rawValue = configuredValue ?? defaultValue;
  let parsedValueWei;
  try {
    parsedValueWei = ethers.parseEther(String(rawValue));
  } catch {
    throw new Error(`${variableName} must be a decimal BNB amount, received "${rawValue}"`);
  }
  if (parsedValueWei < 0n) {
    throw new Error(`${variableName} must not be negative, received "${rawValue}"`);
  }
  return parsedValueWei;
}

// The sponsored leg is a hot wallet paying gas for collection. These caps make
// the most it can lose per transfer, per cycle and per rolling day explicit,
// so a wrong gas setting or a loop over many addresses cannot drain it quietly.
export function resolveGasSponsorshipLimits() {
  return {
    maxBnbPerSweepWei: parseBnbLimitWei(
      'GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP',
      process.env.GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP,
      DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_SWEEP
    ),
    maxBnbPerCycleWei: parseBnbLimitWei(
      'GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE',
      process.env.GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE,
      DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_CYCLE
    ),
    maxBnbPerDayWei: parseBnbLimitWei(
      'GAS_SPONSORSHIP_MAX_BNB_PER_DAY',
      process.env.GAS_SPONSORSHIP_MAX_BNB_PER_DAY,
      DEFAULT_GAS_SPONSORSHIP_MAX_BNB_PER_DAY
    ),
  };
}

export function resolveGasSponsorshipSpendWindowHours() {
  const configuredWindowHours = Number(
    process.env.GAS_SPONSORSHIP_SPEND_WINDOW_HOURS
      ?? DEFAULT_GAS_SPONSORSHIP_SPEND_WINDOW_HOURS
  );
  if (!Number.isFinite(configuredWindowHours) || configuredWindowHours <= 0) {
    throw new Error(
      `GAS_SPONSORSHIP_SPEND_WINDOW_HOURS must be a positive number, received "${configuredWindowHours}"`
    );
  }
  return configuredWindowHours;
}

/**
 * What has already been spent on sponsored BNB in the rolling window.
 *
 * `sweeps.bnb_funded` is written before the transfer is broadcast, so this sum
 * includes a transfer that later failed for an unrelated reason: the BNB was
 * still sent and must count against the budget.
 */
export async function fetchSponsoredBnbSpentInRollingWindow({
  windowHours = resolveGasSponsorshipSpendWindowHours(),
} = {}) {
  const result = await pool.query(
    `SELECT (COALESCE(
              SUM(COALESCE(bnb_funded_wei, bnb_funded * 1000000000000000000)),
              0
            ))::NUMERIC(78, 0) AS sponsored_bnb_wei
       FROM sweeps
      WHERE (bnb_funded_wei > 0 OR bnb_funded > 0)
        AND created_at >= now() - make_interval(hours => $1)`,
    [windowHours]
  );
  return BigInt(result.rows[0].sponsored_bnb_wei);
}

export function evaluateGasSponsorshipDecision({
  requestedBnbWei,
  cycleSpentBnbWei = 0n,
  dailySpentBnbWei = 0n,
  limits = resolveGasSponsorshipLimits(),
}) {
  const requestedAmountWei = BigInt(requestedBnbWei);
  const cycleSpentAmountWei = BigInt(cycleSpentBnbWei);
  const dailySpentAmountWei = BigInt(dailySpentBnbWei);

  const decisionContext = {
    requestedBnbWei: requestedAmountWei,
    cycleSpentBnbWei: cycleSpentAmountWei,
    dailySpentBnbWei: dailySpentAmountWei,
    limits,
  };

  if (requestedAmountWei <= 0n) {
    return { allowed: true, reason: GAS_SPONSORSHIP_NOT_REQUIRED, ...decisionContext };
  }

  if (requestedAmountWei > limits.maxBnbPerSweepWei) {
    return {
      allowed: false,
      reason: GAS_SPONSORSHIP_PER_SWEEP_LIMIT_EXCEEDED,
      ...decisionContext,
    };
  }

  if (cycleSpentAmountWei + requestedAmountWei > limits.maxBnbPerCycleWei) {
    return {
      allowed: false,
      reason: GAS_SPONSORSHIP_PER_CYCLE_LIMIT_EXCEEDED,
      ...decisionContext,
    };
  }

  if (dailySpentAmountWei + requestedAmountWei > limits.maxBnbPerDayWei) {
    return {
      allowed: false,
      reason: GAS_SPONSORSHIP_DAILY_LIMIT_EXCEEDED,
      ...decisionContext,
    };
  }

  return { allowed: true, reason: GAS_SPONSORSHIP_WITHIN_LIMITS, ...decisionContext };
}

export function buildGasSponsorshipRefusalMessage({
  orderId,
  depositAddress,
  sponsorshipDecision,
}) {
  return (
    `Gas sponsorship refused for order ${orderId} (deposit ${depositAddress}): `
    + `${sponsorshipDecision.reason}. Requested ${ethers.formatEther(sponsorshipDecision.requestedBnbWei)} BNB, `
    + `cycle spent ${ethers.formatEther(sponsorshipDecision.cycleSpentBnbWei)} BNB, `
    + `rolling day spent ${ethers.formatEther(sponsorshipDecision.dailySpentBnbWei)} BNB.`
  );
}
