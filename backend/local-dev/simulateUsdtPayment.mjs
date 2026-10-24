import { ethers } from 'ethers';
import '../config/environment.js';

import { TICKET_PRICE_USDT } from '../../shared/eventConfig.js';

const MOCK_USDT_ABI = [
  'function mint(address to, uint256 amount) external',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// Anvil's deterministic account[2]; on the BSC testnet the payer key written by
// local-dev/setupBscTestnet.sh is used instead.
const ANVIL_FALLBACK_PAYER_PRIVATE_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const simulatedPayerPrivateKey =
  process.env.BSC_TESTNET_PAYER_PRIVATE_KEY || ANVIL_FALLBACK_PAYER_PRIVATE_KEY;

const depositAddressArg = process.argv[2];
const requestedAmountUsdt = process.argv[3];

if (!depositAddressArg) {
  console.error('Usage: node local-dev/simulateUsdtPayment.mjs <depositAddress> [amountUsdt]');
  process.exit(1);
}

const transferAmountUsdt = Number(requestedAmountUsdt || TICKET_PRICE_USDT);

const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'http://127.0.0.1:8545');
const payerWallet = new ethers.Wallet(simulatedPayerPrivateKey, provider);
const usdtContractAddress = process.env.USDT_CONTRACT_ADDRESS;
if (!usdtContractAddress) {
  console.error(
    'USDT_CONTRACT_ADDRESS not set. Run local-dev/setupLocalChain.sh (Anvil) or local-dev/setupBscTestnet.sh (testnet) first.'
  );
  process.exit(1);
}

const usdtContract = new ethers.Contract(usdtContractAddress, MOCK_USDT_ABI, payerWallet);
const transferAmountWei = ethers.parseUnits(String(transferAmountUsdt), 18);

let nextPendingNonce = await provider.getTransactionCount(payerWallet.address, 'pending');

const payerBalanceWei = await usdtContract.balanceOf(payerWallet.address);
if (payerBalanceWei < transferAmountWei) {
  console.log(
    `Payer ${payerWallet.address} has ${ethers.formatUnits(payerBalanceWei, 18)} mUSDT; minting ${transferAmountUsdt}...`
  );
  const mintReceipt = await (
    await usdtContract.mint(payerWallet.address, transferAmountWei, { nonce: nextPendingNonce })
  ).wait();
  nextPendingNonce += 1;
  console.log(`Minted at block ${mintReceipt.blockNumber} (tx ${mintReceipt.hash})`);
}

console.log(
  `Transferring ${transferAmountUsdt} mUSDT from payer ${payerWallet.address} to deposit ${depositAddressArg}...`
);
const transferReceipt = await (
  await usdtContract.transfer(depositAddressArg, transferAmountWei, { nonce: nextPendingNonce })
).wait();
console.log(`Transferred at block ${transferReceipt.blockNumber} (tx ${transferReceipt.hash})`);

const depositBalanceWei = await usdtContract.balanceOf(depositAddressArg);
console.log(`Deposit address now holds ${ethers.formatUnits(depositBalanceWei, 18)} mUSDT`);
