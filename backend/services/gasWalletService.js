import { ethers } from 'ethers';

import { createUsdtProvider, getTreasuryWalletAddress } from './usdtPaymentService.js';

export const DEFAULT_SWEEP_ESTIMATED_GAS_UNITS = 65000;
export const DEFAULT_SWEEP_GAS_BUFFER_PERCENT = 20;
export const DEFAULT_SWEEP_MIN_THRESHOLD_USDT = 10;
export const DEFAULT_SWEEP_GAS_PRICE_BUMP_PERCENT = 20;
export const DEFAULT_SWEEP_MAX_RETRIES = 2;
export const DEFAULT_SWEEP_FALLBACK_GAS_PRICE_WEI = 3000000000n;

export function resolveGasWalletPrivateKey() {
  const gasWalletPrivateKey = process.env.GAS_WALLET_PRIVATE_KEY;
  if (!gasWalletPrivateKey) {
    throw new Error('GAS_WALLET_PRIVATE_KEY is not configured');
  }
  return gasWalletPrivateKey;
}

export function getSweepEstimatedGasUnits() {
  return Number(process.env.SWEEP_ESTIMATED_GAS_UNITS || DEFAULT_SWEEP_ESTIMATED_GAS_UNITS);
}

export function getSweepGasBufferPercent() {
  return Number(process.env.SWEEP_GAS_BUFFER_PERCENT || DEFAULT_SWEEP_GAS_BUFFER_PERCENT);
}

export function getSweepMinThresholdUsdt() {
  return Number(process.env.SWEEP_MIN_THRESHOLD_USDT || DEFAULT_SWEEP_MIN_THRESHOLD_USDT);
}

export function getSweepGasPriceBumpPercent() {
  return Number(process.env.SWEEP_GAS_PRICE_BUMP_PERCENT || DEFAULT_SWEEP_GAS_PRICE_BUMP_PERCENT);
}

export function getSweepMaxRetries() {
  return Number(process.env.SWEEP_MAX_RETRIES || DEFAULT_SWEEP_MAX_RETRIES);
}

export function getSweepFallbackGasPriceWei() {
  const configuredFallbackGasPrice = process.env.SWEEP_FALLBACK_GAS_PRICE_WEI;
  if (!configuredFallbackGasPrice) {
    return DEFAULT_SWEEP_FALLBACK_GAS_PRICE_WEI;
  }
  return BigInt(configuredFallbackGasPrice);
}

export function computeBumpedGasPriceWei(originalGasPriceWei, bumpPercent) {
  const bumpMultiplier = 100n + BigInt(bumpPercent);
  return (originalGasPriceWei * bumpMultiplier) / 100n;
}

export function createGasWalletSigner(provider = createUsdtProvider()) {
  return new ethers.Wallet(resolveGasWalletPrivateKey(), provider);
}

export async function fetchGasWalletBnbBalance(signer = createGasWalletSigner()) {
  return signer.provider.getBalance(signer.address);
}

export async function fetchUsdtBalanceAtDepositAddress(depositAddress, provider = createUsdtProvider()) {
  const usdtContractAddress = process.env.USDT_CONTRACT_ADDRESS;
  if (!usdtContractAddress) {
    throw new Error('USDT_CONTRACT_ADDRESS is not configured');
  }
  const usdtContract = new ethers.Contract(usdtContractAddress, [
    'function balanceOf(address account) view returns (uint256)',
  ], provider);
  return usdtContract.balanceOf(depositAddress);
}

export async function fetchBnbBalanceAtDepositAddress(depositAddress, provider = createUsdtProvider()) {
  return provider.getBalance(depositAddress);
}

/**
 * BSC fee data does not always carry gasPrice (it can be null on an EIP-1559
 * shaped response), so maxFeePerGas and then the configured fallback are used
 * before giving up. BigInt(null) would throw and abort the whole sweep pass.
 */
export async function fetchCurrentBscGasPrice(provider = createUsdtProvider()) {
  const feeData = await provider.getFeeData();
  const gasPriceCandidates = [feeData?.gasPrice, feeData?.maxFeePerGas];
  for (const gasPriceCandidate of gasPriceCandidates) {
    if (gasPriceCandidate !== null && gasPriceCandidate !== undefined) {
      return BigInt(gasPriceCandidate);
    }
  }
  return getSweepFallbackGasPriceWei();
}

export function computeSweepGasFeeWei(gasPriceWei, estimatedGasUnits, bufferPercent) {
  const baseFeeWei = gasPriceWei * BigInt(estimatedGasUnits);
  const bufferMultiplier = 100n + BigInt(bufferPercent);
  return (baseFeeWei * bufferMultiplier) / 100n;
}

export async function transferBnbFromGasWalletToDepositAddress(depositAddress, bnbAmountWei, gasWalletSigner = createGasWalletSigner()) {
  const fundingResponse = await gasWalletSigner.sendTransaction({
    to: depositAddress,
    value: bnbAmountWei,
  });
  return fundingResponse.wait();
}

export function convertSweepGasFeeToWeiForThresholdCheck(depositUsdtBalanceWei, usdtDecimals = 18) {
  const usdtBalanceUsdt = Number(ethers.formatUnits(depositUsdtBalanceWei, usdtDecimals));
  return usdtBalanceUsdt >= getSweepMinThresholdUsdt();
}

export function getTreasuryUsdtBalanceWei(provider = createUsdtProvider()) {
  const treasuryWalletAddress = getTreasuryWalletAddress();
  const usdtContract = new ethers.Contract(process.env.USDT_CONTRACT_ADDRESS, [
    'function balanceOf(address account) view returns (uint256)',
  ], provider);
  return usdtContract.balanceOf(treasuryWalletAddress);
}