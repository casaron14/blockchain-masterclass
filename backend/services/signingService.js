import '../config/environment.js';

import { ethers } from 'ethers';

export const BIP44_ETHEREUM_COIN_TYPE = 60;
export const BIP44_EXTERNAL_CHAIN_INDEX = 0;
export const BIP44_ACCOUNT_HARDENED = 0;

export function resolveMasterMnemonic() {
  const masterMnemonic = process.env.WALLET_MNEMONIC;
  if (!masterMnemonic) {
    throw new Error('WALLET_MNEMONIC is not configured');
  }
  return masterMnemonic;
}

export function buildBip44DerivationPath(derivationIndex) {
  if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
    throw new Error(`Invalid derivation index: ${derivationIndex}`);
  }
  return `m/44'/${BIP44_ETHEREUM_COIN_TYPE}'/${BIP44_ACCOUNT_HARDENED}'/${BIP44_EXTERNAL_CHAIN_INDEX}/${derivationIndex}`;
}

// Development/test fallback only. The API process derives deposit addresses
// from WALLET_ACCOUNT_XPUB in depositAddressDerivationService.js in production
// and config/productionSigningGuard.js enforces that. Nothing here persists a
// private key; each key is derived on demand and discarded immediately.
let cachedMasterHdNode;

function getMasterHdNode() {
  if (!cachedMasterHdNode) {
    cachedMasterHdNode = ethers.HDNodeWallet.fromPhrase(
      resolveMasterMnemonic(),
      undefined,
      'm'
    );
  }
  return cachedMasterHdNode;
}

/**
 * Development/test fallback only. Production derives deposit addresses from
 * WALLET_ACCOUNT_XPUB in depositAddressDerivationService.js and never calls
 * this function; config/productionSigningGuard.js enforces that.
 */
export function deriveDepositAddressFromMasterMnemonicForDerivationIndex(derivationIndex) {
  const derivationPath = buildBip44DerivationPath(derivationIndex);
  const derivedNode = getMasterHdNode().derivePath(derivationPath);
  return {
    address: derivedNode.address,
    derivationPath,
  };
}
