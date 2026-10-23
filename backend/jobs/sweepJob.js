import {
  runSweepCycle,
  fetchMostRecentSweepRecordTimestamp,
} from '../services/sweepService.js';

export const DEFAULT_SWEEP_INTERVAL_HOURS = 24;
export const SWEEP_SKIPPED_ALREADY_SWEPT_TODAY = 'ALREADY_SWEPT_TODAY';

export function getSweepIntervalHours() {
  return Number(process.env.SWEEP_INTERVAL_HOURS || DEFAULT_SWEEP_INTERVAL_HOURS);
}

export function computeHoursSinceLastSweep(lastSweepRunAt, now = new Date()) {
  if (!lastSweepRunAt) {
    return null;
  }
  return (now.getTime() - new Date(lastSweepRunAt).getTime()) / (1000 * 60 * 60);
}

/**
 * Sweeping is scheduled once a day, not on every poll tick: moving a deposit
 * the moment a payment is confirmed destroys the evidence the confirmation
 * path needs. The newest sweeps row is the durable last-run timestamp, so a
 * process restart cannot sweep twice inside the same window.
 */
export async function runSweepJob({
  provider,
  intervalHours = getSweepIntervalHours(),
  minimumAgeHours,
  triggeredBy = 'scheduled',
  now = new Date(),
  sweepCycleDependencies = {},
  fetchLastSweepRunAt = fetchMostRecentSweepRecordTimestamp,
  runCycle = runSweepCycle,
} = {}) {
  const lastSweepRunAt = await fetchLastSweepRunAt();
  const hoursSinceLastSweep = computeHoursSinceLastSweep(lastSweepRunAt, now);

  if (hoursSinceLastSweep !== null && hoursSinceLastSweep < intervalHours) {
    return {
      skipped: true,
      reason: SWEEP_SKIPPED_ALREADY_SWEPT_TODAY,
      lastSweepRunAt,
      hoursSinceLastSweep,
      intervalHours,
      sweptCount: 0,
      results: [],
    };
  }

  const sweepCycleArguments = {
    triggeredBy,
    minimumAgeHours,
    ...sweepCycleDependencies,
  };
  if (provider !== undefined) {
    sweepCycleArguments.provider = provider;
  }

  const sweepResults = await runCycle(sweepCycleArguments);

  const sweptCount = sweepResults.filter((sweepResult) => sweepResult.swept).length;
  const failedCount = sweepResults.filter(
    (sweepResult) => sweepResult.reason === 'SWEEP_ERROR'
  ).length;
  if (sweptCount > 0) {
    console.log(`Sweep job: swept ${sweptCount} order(s)`);
  }

  return {
    skipped: false,
    lastSweepRunAt: now.toISOString(),
    hoursSinceLastSweep,
    intervalHours,
    sweptCount,
    failedCount,
    results: sweepResults,
  };
}