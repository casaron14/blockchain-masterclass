import { ethers } from 'ethers';

import {
  DEFAULT_USDT_DECIMALS,
  getUsdtContractAddress,
} from './usdtPaymentService.js';

export const ALCHEMY_ADDRESS_ACTIVITY_WEBHOOK_TYPE = 'ADDRESS_ACTIVITY';
export const ALCHEMY_BSC_MAINNET_NETWORK_NAME = 'BNB_MAINNET';
export const ALCHEMY_BSC_TESTNET_NETWORK_NAME = 'BNB_TESTNET';

export const ALCHEMY_WEBHOOK_STATUS_ACCEPTED = 'ACCEPTED';
export const ALCHEMY_WEBHOOK_STATUS_IGNORED = 'IGNORED';

export const ALCHEMY_WEBHOOK_IGNORED_UNSUPPORTED_TYPE = 'UNSUPPORTED_WEBHOOK_TYPE';
export const ALCHEMY_WEBHOOK_IGNORED_UNEXPECTED_NETWORK = 'UNEXPECTED_NETWORK';
export const ALCHEMY_WEBHOOK_IGNORED_NO_MATCHING_TRANSFERS = 'NO_MATCHING_TRANSFERS';

// Alchemy labels the two BSC networks it serves by name, not chain id, so the
// configured CHAIN_ID has to be translated before the payload is trusted.
export function resolveExpectedAlchemyBscNetworkName(chainId = process.env.CHAIN_ID) {
  return Number(chainId) === 97
    ? ALCHEMY_BSC_TESTNET_NETWORK_NAME
    : ALCHEMY_BSC_MAINNET_NETWORK_NAME;
}

// An Address Activity payload carries native transfers, token transfers and
// contract calls for the watched addresses. Only a positive-value transfer of
// the configured USDT contract into one of those addresses is a deposit.
//
// The payload's value field is a float, so the integer amount is read from
// rawContract.rawValue, the same way the eth_getLogs listener reads the log
// data. Rounding here would corrupt the amount compared against the ticket price.
function parseAlchemyActivityAsUsdtTransfer(activity, usdtContractAddress) {
  if (!activity || activity.removed === true) {
    return null;
  }

  // Alchemy reports ERC-20 transfers as `token` on newer payloads and `erc20`
  // on older ones, so both are accepted and everything else is skipped.
  if (activity.category !== 'token' && activity.category !== 'erc20') {
    return null;
  }

  const activityContractAddress = activity.rawContract?.address;
  if (!activityContractAddress) {
    return null;
  }
  if (
    String(activityContractAddress).toLowerCase()
    !== String(usdtContractAddress).toLowerCase()
  ) {
    return null;
  }

  if (!activity.toAddress || !activity.hash) {
    return null;
  }

  const rawValue = activity.rawContract?.rawValue;
  if (!rawValue) {
    return null;
  }

  let amountWei;
  try {
    amountWei = BigInt(rawValue);
  } catch {
    return null;
  }
  if (amountWei <= 0n) {
    return null;
  }

  const blockNumber = Number(activity.blockNum);
  if (!Number.isFinite(blockNumber) || blockNumber <= 0) {
    return null;
  }

  const tokenDecimals = Number(activity.rawContract?.decimals ?? DEFAULT_USDT_DECIMALS);

  return {
    txHash: activity.hash,
    blockNumber,
    // Address Activity does not report the block hash. The reorg guard skips a
    // deposit without one and the polling scan re-reads the same window, so the
    // record is still verified before it can confirm a payment.
    blockHash: null,
    logIndex: Number(activity.log?.logIndex ?? 0),
    fromAddress: activity.fromAddress ?? null,
    toAddress: activity.toAddress,
    amountWei,
    amountUsdt: Number(ethers.formatUnits(amountWei, tokenDecimals)),
  };
}

export function buildObservedUsdtTransfersFromAlchemyActivityWebhookPayload(
  webhookPayload,
  {
    usdtContractAddress = getUsdtContractAddress(),
    expectedNetworkName = resolveExpectedAlchemyBscNetworkName(),
  } = {}
) {
  if (!webhookPayload || webhookPayload.type !== ALCHEMY_ADDRESS_ACTIVITY_WEBHOOK_TYPE) {
    return {
      status: ALCHEMY_WEBHOOK_STATUS_IGNORED,
      reason: ALCHEMY_WEBHOOK_IGNORED_UNSUPPORTED_TYPE,
      parsedTransfers: [],
    };
  }

  const webhookEvent = webhookPayload.event ?? {};
  if (expectedNetworkName && webhookEvent.network !== expectedNetworkName) {
    return {
      status: ALCHEMY_WEBHOOK_STATUS_IGNORED,
      reason: ALCHEMY_WEBHOOK_IGNORED_UNEXPECTED_NETWORK,
      parsedTransfers: [],
    };
  }

  const parsedTransfers = [];
  for (const activity of Array.isArray(webhookEvent.activity)
    ? webhookEvent.activity
    : []) {
    const parsedTransfer = parseAlchemyActivityAsUsdtTransfer(
      activity,
      usdtContractAddress
    );
    if (parsedTransfer) {
      parsedTransfers.push(parsedTransfer);
    }
  }

  if (parsedTransfers.length === 0) {
    return {
      status: ALCHEMY_WEBHOOK_STATUS_IGNORED,
      reason: ALCHEMY_WEBHOOK_IGNORED_NO_MATCHING_TRANSFERS,
      parsedTransfers: [],
    };
  }

  return {
    status: ALCHEMY_WEBHOOK_STATUS_ACCEPTED,
    reason: null,
    parsedTransfers,
  };
}
