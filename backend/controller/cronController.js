import crypto from 'node:crypto';

import { runScheduledJobTick } from '../jobs/runScheduledJobTick.js';
import { logError } from '../utils/applicationLogger.js';

function computeSecretDigest(secretValue) {
  return crypto.createHash('sha256').update(String(secretValue)).digest();
}

export function matchesCronSecret(authorizationHeader, configuredCronSecret) {
  if (!configuredCronSecret || !authorizationHeader) {
    return false;
  }
  const presentedDigest = computeSecretDigest(authorizationHeader);
  const expectedDigest = computeSecretDigest(`Bearer ${configuredCronSecret}`);
  return crypto.timingSafeEqual(presentedDigest, expectedDigest);
}

async function runScheduledJobTickEndpoint(req, res) {
  const configuredCronSecret = process.env.CRON_SECRET;

  // Failing closed is deliberate: an unauthenticated endpoint that triggers
  // sweeps and mail would be worse than a scheduler that does not run.
  if (!configuredCronSecret) {
    return res.status(503).json({
      message: 'CRON_SECRET is not configured',
      error: 'CRON_NOT_CONFIGURED',
    });
  }

  if (!matchesCronSecret(req.headers.authorization, configuredCronSecret)) {
    return res.status(401).json({
      message: 'Invalid scheduler credentials',
      error: 'CRON_UNAUTHORIZED',
    });
  }

  try {
    const jobOutcomes = await runScheduledJobTick();
    return res.status(200).json({ ok: true, jobs: jobOutcomes });
  } catch (error) {
    logError('scheduled_job_tick_failed', { errorMessage: error.message });
    return res.status(500).json({
      message: 'Scheduled job tick failed',
      error: 'CRON_TICK_FAILED',
    });
  }
}

export default {
  runScheduledJobTickEndpoint,
};
