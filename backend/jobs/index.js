import { runPaymentMonitorJob } from './paymentMonitorJob.js';
import { runListenerHealthCheckJob } from './listenerHealthCheckJob.js';
import { runOrderExpiryJob } from './expireOrdersJob.js';
import { runExpireSeatHoldsJob } from './expireSeatHoldsJob.js';
import { runTicketDeliveryRetryJob } from './ticketDeliveryRetryJob.js';

function resolveJobIntervalMs(envValue, defaultMs) {
  return Number(envValue || defaultMs);
}

export function isJobEnabled(jobName) {
  return process.env[`ENABLE_${jobName}_JOB`] === 'true';
}

export function startBlockchainBackgroundJobs() {
  const activeJobIntervals = [];

  const monitorIntervalMs = resolveJobIntervalMs(
    process.env.MONITOR_POLL_INTERVAL_MS,
    5000
  );
  const listenerHealthIntervalMs = resolveJobIntervalMs(
    process.env.LISTENER_HEALTH_CHECK_INTERVAL_MS,
    60000
  );
  const expiryIntervalMs = resolveJobIntervalMs(
    process.env.ORDER_EXPIRY_INTERVAL_MS,
    60000
  );
  const ticketDeliveryRetryIntervalMs = resolveJobIntervalMs(
    process.env.TICKET_DELIVERY_RETRY_INTERVAL_MS,
    300000
  );

  // The listener is the only job that must not be given a long interval: a
  // client is watching a countdown, so the default is a few seconds. It also
  // runs once immediately, so a payment that landed while the process was
  // restarting is picked up without waiting for the first interval to elapse.
  if (isJobEnabled('PAYMENT_MONITOR')) {
    runPaymentMonitorJob().catch((error) =>
      console.error('Payment monitor job error', error)
    );
    const intervalId = setInterval(() => {
      runPaymentMonitorJob().catch((error) =>
        console.error('Payment monitor job error', error)
      );
    }, monitorIntervalMs);
    activeJobIntervals.push(intervalId);
  }

  if (isJobEnabled('LISTENER_HEALTH')) {
    runListenerHealthCheckJob().catch((error) =>
      console.error('Listener health check job error', error)
    );
    const intervalId = setInterval(() => {
      runListenerHealthCheckJob().catch((error) =>
        console.error('Listener health check job error', error)
      );
    }, listenerHealthIntervalMs);
    activeJobIntervals.push(intervalId);
  }

  if (isJobEnabled('SEAT_HOLDS')) {
    const seatHoldIntervalMs = resolveJobIntervalMs(
      process.env.SEAT_HOLDS_INTERVAL_MS,
      60000
    );
    const intervalId = setInterval(() => {
      runExpireSeatHoldsJob().catch((error) =>
        console.error('Seat holds job error', error)
      );
    }, seatHoldIntervalMs);
    activeJobIntervals.push(intervalId);
  }

  if (isJobEnabled('ORDER_EXPIRY')) {
    const intervalId = setInterval(() => {
      runOrderExpiryJob().catch((error) =>
        console.error('Order expiry job error', error)
      );
    }, expiryIntervalMs);
    activeJobIntervals.push(intervalId);
  }

  if (isJobEnabled('TICKET_DELIVERY_RETRY')) {
    const intervalId = setInterval(() => {
      runTicketDeliveryRetryJob().catch((error) =>
        console.error('Ticket delivery retry job error', error)
      );
    }, ticketDeliveryRetryIntervalMs);
    activeJobIntervals.push(intervalId);
  }

  return {
    stop() {
      for (const intervalId of activeJobIntervals) {
        clearInterval(intervalId);
      }
      activeJobIntervals.length = 0;
    },
  };
}
