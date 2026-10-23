import pool from '../config/db.js';

import { getTreasuryWalletAddress, DEFAULT_USDT_DECIMALS } from './usdtPaymentService.js';

import { fetchGasWalletBnbBalance, getTreasuryUsdtBalanceWei, createGasWalletSigner } from './gasWalletService.js';

import { fetchPaidOrdersAwaitingSweep, fetchPendingOrderRecords, fetchPaidOrderRecords } from './orderService.js';

import { SWEEP_SUCCESS_STATUSES } from './sweepVerificationService.js';

export const RECONCILIATION_STATUS_BALANCED = 'balanced';
export const RECONCILIATION_STATUS_MISMATCH = 'mismatch';
export const RECONCILIATION_STATUS_FAILED = 'failed';

const CONFIRMED_REVENUE_ORDER_STATUSES = ['paid', 'swept'];

/**
 * Deposits that belong to an order which never reached a confirmed state are
 * not revenue: they are money sitting on a deposit address for an expired or
 * abandoned order, and they must never be counted against the treasury.
 */
export async function fetchSumOfConfirmedOrderDepositsUsdt() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(deposit.amount), 0)::NUMERIC(14,2) AS confirmed_revenue_total
       FROM deposits_observed deposit
       JOIN orders o ON o.id = deposit.order_id
      WHERE o.status = ANY($1::order_status[])`,
    [CONFIRMED_REVENUE_ORDER_STATUSES]
  );
  return Number(result.rows[0].confirmed_revenue_total);
}

/**
 * Deposits on confirmed orders that have been observed but not yet collected.
 * These are in flight, not mismatched, so they are reported separately rather
 * than alerting the operator every sweep cycle.
 */
export async function fetchSumOfInFlightConfirmedDepositsUsdt() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(deposit.amount), 0)::NUMERIC(14,2) AS in_flight_total
       FROM deposits_observed deposit
       JOIN orders o ON o.id = deposit.order_id
      WHERE o.status = ANY($1::order_status[])
        AND NOT EXISTS (
          SELECT 1 FROM sweeps s
           WHERE s.order_id = o.id
             AND s.status = ANY($2::sweep_status[])
             AND s.tx_hash IS NOT NULL
        )`,
    [CONFIRMED_REVENUE_ORDER_STATUSES, [...SWEEP_SUCCESS_STATUSES]]
  );
  return Number(result.rows[0].in_flight_total);
}

export async function fetchSumOfConfirmedDepositsUsdt() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::NUMERIC(14,2) AS total_confirmed
       FROM deposits_observed`
  );
  return Number(result.rows[0].total_confirmed);
}

export async function fetchSumOfTreasuryLedgerUsdt() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::NUMERIC(14,2) AS total_swept
       FROM treasury_ledger`
  );
  return Number(result.rows[0].total_swept);
}

export async function fetchOnChainTreasuryUsdtBalance(
  fetchTreasuryBalance = getTreasuryUsdtBalanceWei,
  provider
) {
  const treasuryBalanceWei = await fetchTreasuryBalance(provider);
  return Number(treasuryBalanceWei) / 10 ** DEFAULT_USDT_DECIMALS;
}

function computeSettledDepositsUsdt(confirmedDepositsUsdt, inFlightDepositsUsdt) {
  return Math.round((confirmedDepositsUsdt - inFlightDepositsUsdt) * 100) / 100;
}

/**
 * Compares three independent views of the same money: what confirmed orders
 * were paid, what has already been moved to the treasury ledger, and what the
 * treasury wallet actually holds on chain. Deposits that are still in flight
 * are subtracted before the comparison so a pending collection is never
 * reported as a mismatch.
 */
export async function runReconciliationCheck({
  fetchConfirmedDeposits = fetchSumOfConfirmedOrderDepositsUsdt,
  fetchInFlightDeposits = fetchSumOfInFlightConfirmedDepositsUsdt,
  fetchTreasuryLedgerTotal = fetchSumOfTreasuryLedgerUsdt,
  fetchOnChainBalance = fetchOnChainTreasuryUsdtBalance,
  provider,
} = {}) {
  const confirmedDepositsUsdt = await fetchConfirmedDeposits();
  const inFlightDepositsUsdt = await fetchInFlightDeposits();
  const treasuryLedgerUsdt = await fetchTreasuryLedgerTotal();
  const onChainTreasuryUsdt = await fetchOnChainBalance(undefined, provider);

  const settledDepositsUsdt = computeSettledDepositsUsdt(confirmedDepositsUsdt, inFlightDepositsUsdt);

  const ledgerMismatch = settledDepositsUsdt !== treasuryLedgerUsdt;
  const chainMismatch = treasuryLedgerUsdt !== onChainTreasuryUsdt;

  return {
    confirmedDepositsUsdt,
    inFlightDepositsUsdt,
    settledDepositsUsdt,
    treasuryLedgerUsdt,
    onChainTreasuryUsdt,
    mismatchUsdt: ledgerMismatch ? treasuryLedgerUsdt - settledDepositsUsdt : 0,
    ledgerMismatch,
    chainMismatch,
    balanced: !ledgerMismatch && !chainMismatch,
  };
}

export async function persistReconciliationRunSummary(summary) {
  const result = await pool.query(
    `INSERT INTO reconciliation_runs
       (started_at, finished_at, status, observed_total, ledger_total,
        onchain_treasury_total, mismatch_usdt, details)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      summary.startedAt ?? new Date(),
      summary.status,
      summary.observedTotal ?? null,
      summary.ledgerTotal ?? null,
      summary.onchainTreasuryTotal ?? null,
      summary.mismatchUsdt ?? null,
      JSON.stringify(summary.details ?? {}),
    ]
  );
  return result.rows[0];
}

export async function fetchMostRecentReconciliationRun() {
  const result = await pool.query(
    'SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT 1'
  );
  return result.rows[0] ?? null;
}

/**
 * Runs one reconciliation pass and persists it, so the history of what the
 * operator was told is inspectable after the fact instead of only ever having
 * been logged.
 */
export async function runReconciliationRun({
  provider,
  startedAt = new Date(),
  persistRunSummary = persistReconciliationRunSummary,
  fetchOnChainBalance = fetchOnChainTreasuryUsdtBalance,
  fetchConfirmedDeposits = fetchSumOfConfirmedOrderDepositsUsdt,
  fetchInFlightDeposits = fetchSumOfInFlightConfirmedDepositsUsdt,
  fetchTreasuryLedgerTotal = fetchSumOfTreasuryLedgerUsdt,
} = {}) {
  let reconciliationCheck;
  let runStatus = RECONCILIATION_STATUS_BALANCED;
  let runFailureMessage = null;

  try {
    reconciliationCheck = await runReconciliationCheck({
      fetchConfirmedDeposits,
      fetchInFlightDeposits,
      fetchTreasuryLedgerTotal,
      fetchOnChainBalance,
      provider,
    });
    runStatus = reconciliationCheck.balanced
      ? RECONCILIATION_STATUS_BALANCED
      : RECONCILIATION_STATUS_MISMATCH;
  } catch (reconciliationError) {
    runStatus = RECONCILIATION_STATUS_FAILED;
    runFailureMessage = reconciliationError.message;
  }

  const persistedRun = await persistRunSummary({
    startedAt,
    status: runStatus,
    observedTotal: reconciliationCheck?.confirmedDepositsUsdt ?? null,
    ledgerTotal: reconciliationCheck?.treasuryLedgerUsdt ?? null,
    onchainTreasuryTotal: reconciliationCheck?.onChainTreasuryUsdt ?? null,
    mismatchUsdt: reconciliationCheck?.mismatchUsdt ?? null,
    details: {
      inFlightDepositsUsdt: reconciliationCheck?.inFlightDepositsUsdt ?? null,
      settledDepositsUsdt: reconciliationCheck?.settledDepositsUsdt ?? null,
      ledgerMismatch: reconciliationCheck?.ledgerMismatch ?? null,
      chainMismatch: reconciliationCheck?.chainMismatch ?? null,
      balanced: reconciliationCheck?.balanced ?? null,
      failureMessage: runFailureMessage,
    },
  });

  return {
    status: runStatus,
    runId: persistedRun ? Number(persistedRun.id) : null,
    startedAt,
    finishedAt: persistedRun ? persistedRun.finished_at : null,
    failureMessage: runFailureMessage,
    ...(reconciliationCheck ?? {}),
  };
}

export async function generateAdminSummaryReport({
  fetchPendingOrders = fetchPendingOrderRecords,
  fetchPaidOrders = fetchPaidOrderRecords,
  fetchOrdersAwaitingSweep = fetchPaidOrdersAwaitingSweep,
  fetchGatewayGasBalance = fetchGasWalletBnbBalance,
  fetchTreasuryBalance = getTreasuryUsdtBalanceWei,
  provider,
} = {}) {
  const pendingOrders = await fetchPendingOrders();
  const paidOrders = await fetchPaidOrders();
  const ordersAwaitingSweep = await fetchOrdersAwaitingSweep();

  let gasWalletBnbBalance;
  try {
    const gasWalletSigner = createGasWalletSigner(provider);
    gasWalletBnbBalance = Number(await fetchGatewayGasBalance(gasWalletSigner)) / 10 ** 18;
  } catch (error) {
    gasWalletBnbBalance = null;
  }

  let treasuryUsdtBalance;
  try {
    const treasuryBalanceWei = await fetchTreasuryBalance(provider);
    treasuryUsdtBalance = Number(treasuryBalanceWei) / 10 ** DEFAULT_USDT_DECIMALS;
  } catch (error) {
    treasuryUsdtBalance = null;
  }

  return {
    treasuryWalletAddress: getTreasuryWalletAddress(),
    pendingOrderCount: pendingOrders.length,
    paidOrderCount: paidOrders.length,
    ordersAwaitingSweep: ordersAwaitingSweep.map((orderRow) => ({
      orderId: orderRow.order_id,
      depositAddress: orderRow.deposit_address,
      amountUsdt: Number(orderRow.amount_usdt),
    })),
    gasWalletBnbBalance,
    treasuryUsdtBalance,
  };
}