import '../config/environment.js';

import { ethers } from 'ethers';

import { resolveBscRpcUrl } from '../services/rpcEndpointResolver.js';
import {
  createUsdtProvider,
  getUsdtContractAddress,
} from '../services/usdtPaymentService.js';
import {
  isAlchemyWebhookAddressRegistryConfigured,
} from '../services/alchemyWebhookAddressRegistry.js';

// A pre-flight check so a deployment does not look healthy while deposit
// detection is silently misconfigured. It reads only public state: no key is
// required and nothing is signed.
async function verifyDepositDetectionSetup() {
  const checks = [];
  const addCheck = (checkName, isHealthy, detail) => {
    checks.push({ checkName, isHealthy, detail });
  };

  const rpcUrl = resolveBscRpcUrl();
  addCheck('RPC URL configured', Boolean(rpcUrl), rpcUrl ?? 'missing');

  const usdtContractAddress = getUsdtContractAddress();
  addCheck(
    'USDT contract address configured',
    ethers.isAddress(usdtContractAddress ?? ''),
    usdtContractAddress ?? 'missing'
  );

  const depositAddressDerivationSource = process.env.WALLET_ACCOUNT_XPUB
    ? 'xpub'
    : process.env.WALLET_MNEMONIC
      ? 'mnemonic'
      : 'missing';

  addCheck(
    'Deposit address derivation configured',
    Boolean(process.env.WALLET_ACCOUNT_XPUB || process.env.WALLET_MNEMONIC),
    depositAddressDerivationSource
  );

  addCheck(
    'Alchemy webhook registration configured',
    isAlchemyWebhookAddressRegistryConfigured(),
    isAlchemyWebhookAddressRegistryConfigured()
      ? 'ALCHEMY_WEBHOOK_ID + ALCHEMY_WEBHOOK_AUTH_TOKEN present'
      : 'ALCHEMY_WEBHOOK_ID and/or ALCHEMY_WEBHOOK_AUTH_TOKEN missing'
  );

  addCheck(
    'Alchemy webhook signing key configured',
    Boolean(process.env.ALCHEMY_WEBHOOK_SIGNING_KEY),
    process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ? 'present' : 'missing'
  );

  try {
    const provider = createUsdtProvider();
    const latestBlockNumber = await provider.getBlockNumber();
    addCheck('RPC reachable', latestBlockNumber > 0, `latest block ${latestBlockNumber}`);
  } catch (rpcError) {
    addCheck('RPC reachable', false, rpcError.message);
  }

  for (const check of checks) {
    console.log(`${check.isHealthy ? 'OK  ' : 'FAIL'} ${check.checkName}: ${check.detail}`);
  }

  if (checks.some((check) => !check.isHealthy)) {
    process.exitCode = 1;
    console.error('Deposit detection setup is incomplete. See the FAIL lines above.');
    return;
  }

  console.log('Deposit detection setup looks healthy.');
}

verifyDepositDetectionSetup().catch((verificationError) => {
  console.error(`Could not verify deposit detection setup: ${verificationError.message}`);
  process.exitCode = 1;
});
