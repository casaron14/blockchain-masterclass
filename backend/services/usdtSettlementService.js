import { ethers } from 'ethers';
import pool from '../config/db.js';

import { TICKET_PRICE_USDT } from './eventConfigService.js';
import { DEFAULT_USDT_DECIMALS } from './usdtPaymentService.js';
import { buildSettlementReadinessDecision, countBlockConfirmations } from './blockFinalityService.js';

// The listener observes transfers; this module turns those observations into a
// decision: "this order has received a settled, complete payment" or "here is
// exactly why not". Amounts are compared as exact integers (wei), never as the
// rounded NUMERIC(14,2) column, so a split payment can never be judged short by
// a rounding error.

// The expected amount comes from the payment row, which is where an admin price
// override is stored. Falling back to the shared static config keeps the
// comparison working for a payment row that predates the override.
export function getExpectedPaymentAmountWei(paymentRecord) {
  const expectedAmount = paymentRecord?.amount_expected ?? TICKET_PRICE_USDT;
  return ethers.parseUnits(String(expectedAmount), DEFAULT_USDT_DECIMALS);
}

export function getExpectedPaymentAmountUsdt(paymentRecord) {
  const expectedAmount = paymentRecord?.amount_expected ?? TICKET_PRICE_USDT;
  return Number(expectedAmount);
}

export function normalizeObservedDepositRecord(depositRow) {
  return {
    ...depositRow,
    id: Number(depositRow.id),
    order_id: Number(depositRow.order_id),
    block_number: Number(depositRow.block_number),
    amount_wei: String(depositRow.amount_wei ?? '0'),
    amount: Number(depositRow.amount),
    is_finalized: depositRow.is_finalized === true,
  };
}

export async function fetchObservedDepositRecordsForOrderId(orderId) {
  const result = await pool.query(
    `SELECT * FROM deposits_observed
      WHERE order_id = $1
      ORDER BY block_number ASC, id ASC`,
    [orderId]
  );
  return result.rows.map(normalizeObservedDepositRecord);
}

export async function fetchObservedDepositRecordById(depositId) {
  const result = await pool.query('SELECT * FROM deposits_observed WHERE id = $1', [depositId]);
  return result.rows[0] ? normalizeObservedDepositRecord(result.rows[0]) : null;
}

export function sumObservedDepositAmountWei(observedDeposits) {
  return observedDeposits.reduce(
    (runningTotal, observedDeposit) => runningTotal + BigInt(observedDeposit.amount_wei),
    0n
  );
}

export function buildCumulativeObservedDepositSummary(observedDeposits) {
  const totalAmountWei = sumObservedDepositAmountWei(observedDeposits);
  const latestObservedBlockNumber = observedDeposits.reduce(
    (latestBlockNumber, observedDeposit) => Math.max(latestBlockNumber, observedDeposit.block_number),
    0
  );

  return {
    observedDepositCount: observedDeposits.length,
    totalAmountWei,
    totalAmountUsdt: Number(ethers.formatUnits(totalAmountWei, DEFAULT_USDT_DECIMALS)),
    latestObservedBlockNumber,
    completingDeposit:
      observedDeposits.length === 0
        ? null
        : observedDeposits.reduce((latestDeposit, observedDeposit) =>
            observedDeposit.block_number >= latestDeposit.block_number
              ? observedDeposit
              : latestDeposit
          ),
  };
}

export async function fetchCumulativeObservedDepositSummaryForOrder(orderId) {
  const observedDeposits = await fetchObservedDepositRecordsForOrderId(orderId);
  return buildCumulativeObservedDepositSummary(observedDeposits);
}

export function evaluateOrderPaymentSettlement({
  paymentRecord,
  observedDeposits,
  settlementFrontier,
}) {
  const cumulativeSummary = buildCumulativeObservedDepositSummary(observedDeposits);
  if (cumulativeSummary.observedDepositCount === 0) {
    return {
      ready: false,
      reason: 'NO_DEPOSIT_OBSERVED',
      ...cumulativeSummary,
      expectedAmountWei: getExpectedPaymentAmountWei(paymentRecord),
    };
  }

  const expectedAmountWei = getExpectedPaymentAmountWei(paymentRecord);
  const readinessDecision = buildSettlementReadinessDecision({
    observedAmountWei: cumulativeSummary.totalAmountWei,
    expectedAmountWei,
    latestBlockNumber: settlementFrontier.latestBlockNumber,
    finalizedBlockNumber: settlementFrontier.finalizedBlockNumber,
    latestObservedBlockNumber: cumulativeSummary.latestObservedBlockNumber,
    settledBy: settlementFrontier.settledBy,
  });

  return {
    ...readinessDecision,
    ...cumulativeSummary,
    expectedAmountWei,
  };
}

// A transfer that arrives after the hold expired is still money. It is
// confirmed when a seat can still be granted (confirmBookingSeatWithinClientCapacity
// accepts a lapsed booking for exactly this reason), and otherwise the
// confirmation transaction records the payment and opens a refund case instead
// of dropping it.
export function buildUnderpaymentExpiryDecision({
  observedAmountWei,
  expectedAmountWei,
  orderExpired,
  underpaymentGracePeriodMinutes,
}) {
  const shortfallWei = BigInt(expectedAmountWei) - BigInt(observedAmountWei);
  if (shortfallWei <= 0n) {
    return { abandoned: false, reason: 'PAYMENT_COMPLETE', shortfallWei: 0n };
  }
  if (!orderExpired) {
    return { abandoned: false, reason: 'STILL_WITHIN_HOLD', shortfallWei };
  }
  return {
    abandoned: underpaymentGracePeriodMinutes === 0,
    reason: 'UNDERPAYMENT_AFTER_HOLD_EXPIRED',
    shortfallWei,
  };
}

export function computeConfirmationsForObservedDeposit({ blockNumber, latestBlockNumber }) {
  return countBlockConfirmations({ blockNumber, latestBlockNumber });
}

export async function markObservedDepositAsFinalized(depositId, finalizedBlockNumber, client = pool) {
  const result = await client.query(
    `UPDATE deposits_observed
        SET is_finalized = true,
            finality_confirmed_at = COALESCE(finality_confirmed_at, now()),
            finalized_block_number = $2
      WHERE id = $1
      RETURNING *`,
    [depositId, finalizedBlockNumber]
  );
  return result.rows[0] ? normalizeObservedDepositRecord(result.rows[0]) : null;
}

export async function markObservedDepositsAsFinalized(depositIds, finalizedBlockNumber, client = pool) {
  if (depositIds.length === 0) {
    return 0;
  }
  const result = await client.query(
    `UPDATE deposits_observed
        SET is_finalized = true,
            finality_confirmed_at = COALESCE(finality_confirmed_at, now()),
            finalized_block_number = $2
      WHERE id = ANY($1::bigint[])
        AND is_finalized = false`,
    [depositIds, finalizedBlockNumber]
  );
  return result.rowCount;
}

export async function refreshObservedDepositConfirmations(latestBlockNumber, client = pool) {
  const result = await client.query(
    `UPDATE deposits_observed
        SET confirmations = GREATEST(0, $1::bigint - block_number + 1)
      WHERE confirmations <> GREATEST(0, $1::bigint - block_number + 1)`,
    [latestBlockNumber]
  );
  return result.rowCount;
}

// A reorg replaced the block a deposit was read from, so the transfer is not on
// the chain any more. The row is removed rather than marked, because a payment
// may legitimately be made again and the second attempt needs its own row.
export async function deleteObservedDepositForReorgedTransfer(depositId, client = pool) {
  const result = await client.query(
    'DELETE FROM deposits_observed WHERE id = $1 RETURNING *',
    [depositId]
  );
  return result.rows[0] ? normalizeObservedDepositRecord(result.rows[0]) : null;
}

export async function fetchUnfinalizedObservedDepositRecords(limit = 50) {
  const result = await pool.query(
    `SELECT * FROM deposits_observed
      WHERE is_finalized = false
      ORDER BY block_number DESC
      LIMIT $1`,
    [limit]
  );
  return result.rows.map(normalizeObservedDepositRecord);
}
