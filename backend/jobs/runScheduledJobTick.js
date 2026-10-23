import pool from '../config/db.js';

import { runPaymentMonitorJob } from './paymentMonitorJob.js';
import { runListenerHealthCheckJob } from './listenerHealthCheckJob.js';
import { runOrderExpiryJob } from './expireOrdersJob.js';
import { runSweepJob } from './sweepJob.js';
import { runReconciliationJob } from './reconciliationJob.js';
import { runGasWalletMonitorJob } from './gasWalletMonitorJob.js';
import { runExpireSeatHoldsJob } from './expireSeatHoldsJob.js';
import { runTicketDeliveryRetryJob } from './ticketDeliveryRetryJob.js';

import { logError, logInfo } from '../utils/applicationLogger.js';

// Serverless schedulers call one endpoint instead of keeping eight intervals
// alive. Each job keeps the same ENABLE_<NAME>_JOB switch as the long-lived
// process, so deploying to Vercel does not silently change which jobs run.
//
// Advisory locks make the tick safe when the scheduler overlaps with itself or
// when two deployments are alive during a rolling release.
const SCHEDULED_JOB_DEFINITIONS = [
  {
    jobName: 'paymentMonitor',
    environmentFlagName: 'ENABLE_PAYMENT_MONITOR_JOB',
    advisoryLockKey: 764101,
    shouldRunAt: () => true,
    run: () => runPaymentMonitorJob(),
  },
  {
    jobName: 'seatHolds',
    environmentFlagName: 'ENABLE_SEAT_HOLDS_JOB',
    advisoryLockKey: 764102,
    shouldRunAt: () => true,
    run: () => runExpireSeatHoldsJob(),
  },
  {
    jobName: 'orderExpiry',
    environmentFlagName: 'ENABLE_ORDER_EXPIRY_JOB',
    advisoryLockKey: 764103,
    shouldRunAt: () => true,
    run: () => runOrderExpiryJob(),
  },
  {
    jobName: 'ticketDeliveryRetry',
    environmentFlagName: 'ENABLE_TICKET_DELIVERY_RETRY_JOB',
    advisoryLockKey: 764104,
    shouldRunAt: (now) => now.getUTCMinutes() % 5 === 0,
    run: () => runTicketDeliveryRetryJob(),
  },
  {
    jobName: 'listenerHealth',
    environmentFlagName: 'ENABLE_LISTENER_HEALTH_JOB',
    advisoryLockKey: 764105,
    shouldRunAt: (now) => now.getUTCMinutes() % 10 === 0,
    run: () => runListenerHealthCheckJob(),
  },
  {
    jobName: 'gasWalletMonitor',
    environmentFlagName: 'ENABLE_GAS_WALLET_MONITOR_JOB',
    advisoryLockKey: 764106,
    shouldRunAt: (now) => now.getUTCMinutes() === 0,
    run: () => runGasWalletMonitorJob(),
  },
  {
    jobName: 'reconciliation',
    environmentFlagName: 'ENABLE_RECONCILIATION_JOB',
    advisoryLockKey: 764107,
    shouldRunAt: (now) => now.getUTCHours() === 2 && now.getUTCMinutes() === 0,
    run: () => runReconciliationJob(),
  },
  {
    jobName: 'sweep',
    environmentFlagName: 'ENABLE_SWEEP_JOB',
    advisoryLockKey: 764108,
    shouldRunAt: (now) => now.getUTCHours() === 3 && now.getUTCMinutes() === 0,
    run: () => runSweepJob({ triggeredBy: 'scheduled' }),
  },
];

function isScheduledJobEnabled(jobDefinition) {
  return process.env[jobDefinition.environmentFlagName] === 'true';
}

async function runScheduledJobUnderAdvisoryLock(jobDefinition) {
  const lockClient = await pool.connect();

  try {
    const lockResult = await lockClient.query(
      'SELECT pg_try_advisory_lock($1) AS did_acquire',
      [jobDefinition.advisoryLockKey]
    );

    if (lockResult.rows[0].did_acquire !== true) {
      return { jobName: jobDefinition.jobName, status: 'SKIPPED_ALREADY_RUNNING' };
    }

    try {
      const jobResult = await jobDefinition.run();
      // runPaymentMonitorJob swallows RPC errors so the timer path keeps
      // ticking; on the cron path that must not be reported as success.
      if (jobResult && jobResult.failed === true) {
        return {
          jobName: jobDefinition.jobName,
          status: 'FAILED',
          errorMessage: jobResult.reason ?? 'Job reported a failure',
        };
      }
      return { jobName: jobDefinition.jobName, status: 'COMPLETED' };
    } catch (error) {
      logError('scheduled_job_failed', {
        jobName: jobDefinition.jobName,
        errorMessage: error.message,
      });
      return {
        jobName: jobDefinition.jobName,
        status: 'FAILED',
        errorMessage: error.message,
      };
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [
        jobDefinition.advisoryLockKey,
      ]);
    }
  } finally {
    lockClient.release();
  }
}

export async function runScheduledJobTick({ now = new Date() } = {}) {
  const jobOutcomes = [];

  for (const jobDefinition of SCHEDULED_JOB_DEFINITIONS) {
    if (!isScheduledJobEnabled(jobDefinition)) {
      jobOutcomes.push({ jobName: jobDefinition.jobName, status: 'DISABLED' });
      continue;
    }

    if (!jobDefinition.shouldRunAt(now)) {
      jobOutcomes.push({ jobName: jobDefinition.jobName, status: 'NOT_DUE' });
      continue;
    }

    jobOutcomes.push(await runScheduledJobUnderAdvisoryLock(jobDefinition));
  }

  logInfo('scheduled_job_tick_completed', {
    jobOutcomes,
  });

  return jobOutcomes;
}
