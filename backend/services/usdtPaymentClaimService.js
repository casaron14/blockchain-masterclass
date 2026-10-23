import { ethers } from 'ethers';

import {
  confirmUsdtOrderPaymentFromObservedDeposits,
  createUsdtProvider,
  DEFAULT_USDT_DECIMALS,
  getUsdtContractAddress,
  parseAllUsdtTransfersFromReceipt,
} from './usdtPaymentService.js';

import { fetchPaymentRecordByBookingId } from './paymentService.js';
import {
  fetchDepositAddressRecordsForOrderId,
  fetchOrderByBookingId,
} from './orderService.js';
import { fetchChainSettlementFrontier } from './blockFinalityService.js';
import {
  evaluateOrderPaymentSettlement,
  fetchObservedDepositRecordsForOrderId,
} from './usdtSettlementService.js';
import { recordObservedUsdtTransfer } from './monitorService.js';
import { deliverTicketForConfirmedBooking } from './ticketDeliveryService.js';
import { deliverPaymentReceiptEmailToAttendee } from './paymentReceiptService.js';
import { PAYMENT_METHOD_USDT_BEP20 } from './eventConfigService.js';

export const USDT_CLAIM_TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND';
export const USDT_CLAIM_TRANSFER_NOT_FOR_THIS_BOOKING = 'TRANSFER_NOT_FOR_THIS_BOOKING';
export const USDT_CLAIM_ORDER_NOT_FOUND = 'USDT_ORDER_NOT_FOUND';
export const USDT_CLAIM_DEPOSIT_ADDRESS_NOT_FOUND = 'USDT_DEPOSIT_ADDRESS_NOT_FOUND';
export const USDT_CLAIM_ALREADY_CONFIRMED = 'ALREADY_CONFIRMED';

export function selectClaimedTransfersForDepositAddresses(
  parsedTransfers,
  depositAddresses
) {
  const depositAddressesInLowercase = new Set(
    depositAddresses.map((depositAddress) => String(depositAddress).toLowerCase())
  );

  return parsedTransfers.filter((parsedTransfer) =>
    depositAddressesInLowercase.has(String(parsedTransfer.toAddress).toLowerCase())
  );
}

export function sumClaimedTransferValuesWei(claimedTransfers) {
  return claimedTransfers.reduce(
    (runningTotalWei, claimedTransfer) => runningTotalWei + BigInt(claimedTransfer.value),
    0n
  );
}

function findReceivingDepositAddressRecord(depositAddressRecords, claimedTransfers) {
  const claimedAddressesInLowercase = new Set(
    claimedTransfers.map((claimedTransfer) => String(claimedTransfer.toAddress).toLowerCase())
  );

  return depositAddressRecords.find((depositAddressRecord) =>
    claimedAddressesInLowercase.has(String(depositAddressRecord.address).toLowerCase())
  );
}

// A payer can present a transaction hash instead of waiting for the listener.
//
// This path never decides that a payment is valid on its own. It does the one
// thing only the claim can do — resolve the transaction to *this* booking's
// deposit address and record the transfer — and then hands the decision to the
// same settlement function the listener uses. Finality, amount, seat capacity,
// receipt issuance and review flags are therefore applied by exactly one code
// path, and a transaction that pays somebody else's deposit address is not
// treated as a failed payment for this booking.
export async function verifyClaimedUsdtTransferForBooking(
  bookingId,
  transactionHash,
  dependencies = {}
) {
  const {
    provider = createUsdtProvider(),
    fetchTransactionReceipt = (claimedTransactionHash) =>
      provider.getTransactionReceipt(claimedTransactionHash),
    fetchSettlementFrontier = fetchChainSettlementFrontier,
    recordObservedTransfer = recordObservedUsdtTransfer,
    confirmOrderPayment = confirmUsdtOrderPaymentFromObservedDeposits,
    deliverTicket = deliverTicketForConfirmedBooking,
    deliverReceiptEmail = deliverPaymentReceiptEmailToAttendee,
  } = dependencies;

  const paymentRecord = await fetchPaymentRecordByBookingId(bookingId);
  if (!paymentRecord) {
    throw new Error('USDT_PAYMENT_NOT_FOUND');
  }
  if (paymentRecord.payment_method !== PAYMENT_METHOD_USDT_BEP20) {
    throw new Error('USDT_INVALID_METHOD');
  }
  if (paymentRecord.status === 'confirmed') {
    return { confirmed: true, alreadyConfirmed: true, reason: USDT_CLAIM_ALREADY_CONFIRMED };
  }

  const orderRecord = await fetchOrderByBookingId(bookingId);
  if (!orderRecord) {
    return { confirmed: false, reason: USDT_CLAIM_ORDER_NOT_FOUND };
  }

  // Superseded addresses are included on purpose: a payer may have sent to the
  // address they were shown before the hold was renewed.
  const depositAddressRecords = await fetchDepositAddressRecordsForOrderId(orderRecord.id);
  if (depositAddressRecords.length === 0) {
    return { confirmed: false, reason: USDT_CLAIM_DEPOSIT_ADDRESS_NOT_FOUND };
  }

  const transactionReceipt = await fetchTransactionReceipt(transactionHash);
  if (!transactionReceipt) {
    return { confirmed: false, reason: USDT_CLAIM_TRANSACTION_NOT_FOUND };
  }

  const parsedTransfers = parseAllUsdtTransfersFromReceipt(
    transactionReceipt,
    getUsdtContractAddress()
  );
  const claimedTransfers = selectClaimedTransfersForDepositAddresses(
    parsedTransfers,
    depositAddressRecords.map((depositAddressRecord) => depositAddressRecord.address)
  );
  if (claimedTransfers.length === 0) {
    return {
      confirmed: false,
      reason: USDT_CLAIM_TRANSFER_NOT_FOR_THIS_BOOKING,
      scannedTransferCount: parsedTransfers.length,
    };
  }

  const receivingDepositAddressRecord = findReceivingDepositAddressRecord(
    depositAddressRecords,
    claimedTransfers
  );
  const claimedTotalWei = sumClaimedTransferValuesWei(claimedTransfers);

  await recordObservedTransfer({
    depositAddressRecord: receivingDepositAddressRecord,
    parsedTransfer: {
      txHash: transactionReceipt.hash,
      blockNumber: Number(transactionReceipt.blockNumber),
      blockHash: transactionReceipt.blockHash,
      logIndex: claimedTransfers[0].logIndex,
      fromAddress: claimedTransfers[0].fromAddress,
      toAddress: receivingDepositAddressRecord.address,
      amountWei: claimedTotalWei,
      amountUsdt: Number(ethers.formatUnits(claimedTotalWei, DEFAULT_USDT_DECIMALS)),
    },
  });

  const settlementFrontier = await fetchSettlementFrontier(provider);
  const observedDeposits = await fetchObservedDepositRecordsForOrderId(orderRecord.id);
  const settlementDecision = evaluateOrderPaymentSettlement({
    paymentRecord,
    observedDeposits,
    settlementFrontier,
  });

  if (!settlementDecision.ready) {
    return {
      confirmed: false,
      reason: settlementDecision.reason,
      observedAmountUsdt: settlementDecision.totalAmountUsdt,
      expectedAmountUsdt: Number(
        ethers.formatUnits(settlementDecision.expectedAmountWei, DEFAULT_USDT_DECIMALS)
      ),
      settlementDecision,
    };
  }

  const chainId = process.env.CHAIN_ID
    ? Number(process.env.CHAIN_ID)
    : Number((await provider.getNetwork()).chainId);

  const confirmationOutcome = await confirmOrderPayment({
    orderId: orderRecord.id,
    bookingId,
    paymentId: paymentRecord.id,
    depositAddress: receivingDepositAddressRecord.address,
    settlementFrontier,
    observedDeposits,
    chainId,
    deliverTicket,
    deliverReceiptEmail,
  });

  return {
    ...confirmationOutcome,
    claim: {
      transactionHash: transactionReceipt.hash,
      matchedTransferCount: claimedTransfers.length,
      claimedAmountUsdt: Number(
        ethers.formatUnits(claimedTotalWei, DEFAULT_USDT_DECIMALS)
      ),
    },
  };
}
