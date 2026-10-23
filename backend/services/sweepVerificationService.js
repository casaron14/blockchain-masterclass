import { ethers } from 'ethers';

import pool from '../config/db.js';

import { DEFAULT_USDT_DECIMALS } from './usdtPaymentService.js';

export const SWEEP_SUCCESS_STATUSES = Object.freeze(['funded', 'swept']);

export const PAYMENT_VERIFIED_FROM_OBSERVED_DEPOSITS = 'VERIFIED_FROM_OBSERVED_DEPOSITS';
export const PAYMENT_VERIFIED_FROM_SWEEP_EVIDENCE_ONLY = 'VERIFIED_FROM_SWEEP_EVIDENCE_ONLY';
export const PAYMENT_NOT_FOUND_IN_EVIDENCE = 'NO_PAYMENT_EVIDENCE_FOUND';
export const PAYMENT_EVIDENCE_BELOW_EXPECTED = 'PAYMENT_EVIDENCE_BELOW_EXPECTED_AMOUNT';

function convertUsdtAmountToWei(usdtAmount) {
  return BigInt(ethers.parseUnits(String(usdtAmount), DEFAULT_USDT_DECIMALS));
}

async function fetchObservedDepositRecordsForOrder(orderId) {
  const result = await pool.query(
    `SELECT id, order_id, address, tx_hash, amount, amount_wei, block_number, block_hash,
            is_finalized, finality_confirmed_at, confirmations, matched_at
       FROM deposits_observed
      WHERE order_id = $1
      ORDER BY matched_at ASC`,
    [orderId]
  );
  return result.rows.map((row) => ({
    depositId: Number(row.id),
    orderId: Number(row.order_id),
    address: row.address,
    txHash: row.tx_hash,
    amountUsdt: Number(row.amount),
    amountWei: row.amount_wei === null ? null : BigInt(row.amount_wei),
    blockNumber: row.block_number === null ? null : Number(row.block_number),
    blockHash: row.block_hash,
    isFinalized: row.is_finalized,
    finalityConfirmedAt: row.finality_confirmed_at,
    confirmations: Number(row.confirmations),
    matchedAt: row.matched_at,
  }));
}

/**
 * Only a sweep row that reached a success status and carries a transaction
 * hash is proof that funds actually left the deposit address. A pending or
 * failed row, or a success row with no hash, proves nothing.
 */
async function fetchTrustedSweepRecordsForDepositAddress(depositAddress, orderId) {
  const result = await pool.query(
    `SELECT s.id, s.order_id, s.address, s.tx_hash, s.status, s.amount, s.amount_wei,
            s.block_number, s.block_hash, s.gas_price_wei, s.is_finalized,
            s.treasury_address, s.triggered_by, s.confirmed_at, s.created_at,
            tl.id AS treasury_ledger_id,
            tl.tx_hash AS treasury_ledger_tx_hash,
            tl.amount AS treasury_ledger_amount,
            tl.recorded_at AS treasury_ledger_recorded_at
       FROM sweeps s
       LEFT JOIN treasury_ledger tl ON tl.sweep_id = s.id
      WHERE s.address = $1
        AND s.order_id = $2
        AND s.status = ANY($3::sweep_status[])
        AND s.tx_hash IS NOT NULL
        -- A completed collection only proves a payment once its block can no
        -- longer be reorged away. Rows created before block tracking existed
        -- have no block number and keep their previous trusted status.
        AND (s.is_finalized OR s.block_number IS NULL)
      ORDER BY s.created_at ASC`,
    [depositAddress, orderId, [...SWEEP_SUCCESS_STATUSES]]
  );

  return result.rows.map((row) => ({
    sweepId: Number(row.id),
    orderId: Number(row.order_id),
    address: row.address,
    txHash: row.tx_hash,
    status: row.status,
    amountUsdt: Number(row.amount),
    amountWei: row.amount_wei === null ? null : BigInt(row.amount_wei),
    blockNumber: row.block_number === null ? null : Number(row.block_number),
    blockHash: row.block_hash,
    gasPriceWei: row.gas_price_wei === null ? null : BigInt(row.gas_price_wei),
    isFinalized: row.is_finalized,
    treasuryAddress: row.treasury_address,
    triggeredBy: row.triggered_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    treasuryLedgerEntry: row.treasury_ledger_id === null
      ? null
      : {
          ledgerId: Number(row.treasury_ledger_id),
          txHash: row.treasury_ledger_tx_hash,
          amountUsdt: Number(row.treasury_ledger_amount),
          recordedAt: row.treasury_ledger_recorded_at,
        },
  }));
}

function sumObservedDepositAmountsWei(observedDepositRecords) {
  return observedDepositRecords.reduce((runningTotal, depositRecord) => {
    const depositAmountWei = depositRecord.amountWei
      ?? convertUsdtAmountToWei(depositRecord.amountUsdt);
    return runningTotal + depositAmountWei;
  }, 0n);
}

function sumTrustedSweepAmountsWei(sweepRecords) {
  return sweepRecords.reduce((runningTotal, sweepRecord) => {
    const sweptAmountWei = sweepRecord.amountWei
      ?? convertUsdtAmountToWei(sweepRecord.amountUsdt);
    return runningTotal + sweptAmountWei;
  }, 0n);
}

function sumTreasuryLedgerAmountsWei(sweepRecords) {
  return sweepRecords.reduce((runningTotal, sweepRecord) => {
    if (!sweepRecord.treasuryLedgerEntry) {
      return runningTotal;
    }
    return runningTotal + convertUsdtAmountToWei(sweepRecord.treasuryLedgerEntry.amountUsdt);
  }, 0n);
}

/**
 * Answers "was at least the expected amount legitimately received on this
 * deposit address, and has it since been collected to the treasury?" using
 * only database evidence, so a payment that was already swept can still be
 * proven without trusting a live token balance or making an RPC call.
 */
export async function verifyPaymentAgainstSweepEvidence({
  orderId,
  depositAddress,
  expectedAmountWei,
}) {
  if (orderId === undefined || orderId === null) {
    throw new Error('orderId is required to verify a payment against sweep evidence');
  }
  if (!depositAddress) {
    throw new Error('depositAddress is required to verify a payment against sweep evidence');
  }
  if (expectedAmountWei === undefined || expectedAmountWei === null) {
    throw new Error('expectedAmountWei is required to verify a payment against sweep evidence');
  }

  const observedDepositRecords = await fetchObservedDepositRecordsForOrder(orderId);
  const sweepRecords = await fetchTrustedSweepRecordsForDepositAddress(depositAddress, orderId);

  const observedDepositsTotalWei = sumObservedDepositAmountsWei(observedDepositRecords);
  const sweptOutTotalWei = sumTrustedSweepAmountsWei(sweepRecords);
  const treasuryLedgerTotalWei = sumTreasuryLedgerAmountsWei(sweepRecords);

  const observedDepositsOnAddressWei = observedDepositRecords
    .filter((depositRecord) => depositRecord.address === depositAddress)
    .reduce((runningTotal, depositRecord) => (
      runningTotal
      + (depositRecord.amountWei ?? convertUsdtAmountToWei(depositRecord.amountUsdt))
    ), 0n);

  // A swept deposit is normally also present in deposits_observed, so the
  // swept-out amount is only added for deposits that were collected before
  // they could be observed; otherwise the same money would be counted twice.
  const sweptOutNotYetObservedWei = sweptOutTotalWei > observedDepositsOnAddressWei
    ? sweptOutTotalWei - observedDepositsOnAddressWei
    : 0n;

  const receivedTotalWei = observedDepositsOnAddressWei + sweptOutNotYetObservedWei;

  return {
    ...decideSweepEvidencePaymentStatus({
      receivedTotalWei,
      observedDepositsOnAddressWei,
      expectedAmountWei,
    }),
    expectedAmountWei: BigInt(expectedAmountWei),
    observedDepositsTotalWei,
    sweptAmountWei: sweptOutTotalWei,
    treasuryLedgerTotalWei,
    collectedToTreasury: treasuryLedgerTotalWei >= BigInt(expectedAmountWei),
    sweepRecords,
    observedDeposits: observedDepositRecords,
  };
}

function decideSweepEvidencePaymentStatus({
  receivedTotalWei,
  observedDepositsOnAddressWei,
  expectedAmountWei,
}) {
  if (receivedTotalWei <= 0n) {
    return { paid: false, reason: PAYMENT_NOT_FOUND_IN_EVIDENCE };
  }
  if (receivedTotalWei < BigInt(expectedAmountWei)) {
    return { paid: false, reason: PAYMENT_EVIDENCE_BELOW_EXPECTED };
  }
  return {
    paid: true,
    reason: observedDepositsOnAddressWei >= BigInt(expectedAmountWei)
      ? PAYMENT_VERIFIED_FROM_OBSERVED_DEPOSITS
      : PAYMENT_VERIFIED_FROM_SWEEP_EVIDENCE_ONLY,
  };
}

/**
 * Payments that are not confirmed but already carry money evidence: an
 * observed deposit, or a sweep that collected the deposit before the
 * confirmation ran. Exactly the records a human or the automated verifier
 * must resolve.
 */
export async function fetchAmbiguousUnconfirmedPaymentRecords() {
  const result = await pool.query(
    `SELECT p.id AS payment_id, p.booking_id, p.status AS payment_status,
            p.amount_expected, p.wallet_address, p.tx_hash, p.created_at AS payment_created_at,
            b.id AS booking_id, b.status AS booking_status,
            o.id AS order_id, o.status AS order_status, o.amount_usdt,
            da.address AS deposit_address,
            COALESCE(observed.observed_deposit_count, 0) AS observed_deposit_count,
            COALESCE(observed.observed_amount_usdt, 0) AS observed_amount_usdt,
            COALESCE(sweeps.successful_sweep_count, 0) AS successful_sweep_count,
            COALESCE(sweeps.swept_amount_usdt, 0) AS swept_amount_usdt,
            COALESCE(sweeps.latest_sweep_tx_hash, '') AS latest_sweep_tx_hash
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN orders o ON o.booking_id = b.id
       LEFT JOIN deposit_addresses da
              ON da.order_id = o.id AND da.is_active
       LEFT JOIN LATERAL (
            SELECT COUNT(*) AS observed_deposit_count,
                   COALESCE(SUM(deposit.amount), 0) AS observed_amount_usdt
              FROM deposits_observed deposit
             WHERE deposit.order_id = o.id
       ) observed ON TRUE
       LEFT JOIN LATERAL (
            SELECT COUNT(*) AS successful_sweep_count,
                   COALESCE(SUM(s.amount), 0) AS swept_amount_usdt,
                   MAX(s.tx_hash) AS latest_sweep_tx_hash
              FROM sweeps s
             WHERE s.order_id = o.id
               AND s.status = ANY($1::sweep_status[])
               AND s.tx_hash IS NOT NULL
       ) sweeps ON TRUE
      WHERE p.status <> 'confirmed'
        AND (
          COALESCE(observed.observed_deposit_count, 0) > 0
          OR COALESCE(sweeps.successful_sweep_count, 0) > 0
        )
      ORDER BY p.created_at ASC`,
    [[...SWEEP_SUCCESS_STATUSES]]
  );

  return result.rows.map((row) => ({
    paymentId: Number(row.payment_id),
    paymentStatus: row.payment_status,
    paymentExpectedUsdt: Number(row.amount_expected),
    paymentTxHash: row.tx_hash,
    paymentWalletAddress: row.wallet_address,
    bookingId: Number(row.booking_id),
    bookingStatus: row.booking_status,
    orderId: Number(row.order_id),
    orderStatus: row.order_status,
    orderAmountUsdt: Number(row.amount_usdt),
    depositAddress: row.deposit_address,
    observedDepositCount: Number(row.observed_deposit_count),
    observedAmountUsdt: Number(row.observed_amount_usdt),
    successfulSweepCount: Number(row.successful_sweep_count),
    sweptAmountUsdt: Number(row.swept_amount_usdt),
    latestSweepTxHash: row.latest_sweep_tx_hash,
    hasSweepEvidence: Number(row.successful_sweep_count) > 0,
    hasObservedDeposits: Number(row.observed_deposit_count) > 0,
  }));
}