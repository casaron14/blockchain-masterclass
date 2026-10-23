import './config/environment.js';

import pool from './config/db.js';
import app from './app.js';
import { startBlockchainBackgroundJobs } from './jobs/index.js';
import { assertProductionSigningConfigurationIsSafe } from './config/productionSigningGuard.js';
import { resolveDepositAddressDerivationMode } from './services/depositAddressDerivationService.js';
import { logError, logInfo } from './utils/applicationLogger.js';

// A long-lived process must never start with the seed phrase online when it is
// meant to run in production.
assertProductionSigningConfigurationIsSafe();

const PORT = Number(process.env.PORT || 3001);
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);

logInfo('deposit_address_derivation_mode_resolved', {
  mode: resolveDepositAddressDerivationMode(),
});

const httpServer = app.listen(PORT, () => {
  logInfo('http_server_listening', { port: PORT });
});

const backgroundJobRunner =
  process.env.ENABLE_JOBS === 'true' && process.env.NODE_ENV !== 'test'
    ? startBlockchainBackgroundJobs()
    : null;

if (backgroundJobRunner) {
  logInfo('background_jobs_started');
}

let isShutdownInProgress = false;

async function shutDownServerGracefully(signalName) {
  if (isShutdownInProgress) {
    return;
  }
  isShutdownInProgress = true;

  logInfo('server_shutdown_started', { signal: signalName });

  // If a connection or a query refuses to settle, exit anyway rather than let
  // the orchestrator SIGKILL the process at an arbitrary moment.
  const forceExitTimer = setTimeout(() => {
    logError('server_shutdown_timed_out', {
      signal: signalName,
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  backgroundJobRunner?.stop();

  await new Promise((resolve) => {
    httpServer.close(resolve);
    // Keep-alive sockets would otherwise hold the server open until they idle
    // out; close the unused ones immediately and let in-flight requests finish.
    httpServer.closeIdleConnections?.();
  });

  await pool.end();

  clearTimeout(forceExitTimer);
  logInfo('server_shutdown_completed', { signal: signalName });
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutDownServerGracefully('SIGTERM');
});

process.on('SIGINT', () => {
  void shutDownServerGracefully('SIGINT');
});
