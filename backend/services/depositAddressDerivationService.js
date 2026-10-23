import '../config/environment.js';

import { ethers } from 'ethers';

import {
  buildBip44DerivationPath,
  deriveDepositAddressFromMasterMnemonicForDerivationIndex,
} from './signingService.js';

export const DEPOSIT_ADDRESS_DERIVATION_MODE_EXTENDED_PUBLIC_KEY = 'EXTENDED_PUBLIC_KEY';
export const DEPOSIT_ADDRESS_DERIVATION_MODE_MASTER_MNEMONIC_DEVELOPMENT_ONLY =
  'MASTER_MNEMONIC_DEVELOPMENT_ONLY';

/**
 * The xpub must be the external-chain node, i.e. the key at
 * `m/44'/60'/0'/0`. Every deposit address is then `xpub.deriveChild(index)`,
 * which needs no private material at all.
 */
export function resolveAccountExtendedPublicKey() {
  const accountExtendedPublicKey = process.env.WALLET_ACCOUNT_XPUB;
  if (!accountExtendedPublicKey) {
    throw new Error('WALLET_ACCOUNT_XPUB is not configured');
  }
  return accountExtendedPublicKey.trim();
}

export function resolveDepositAddressDerivationMode() {
  if (process.env.WALLET_ACCOUNT_XPUB) {
    return DEPOSIT_ADDRESS_DERIVATION_MODE_EXTENDED_PUBLIC_KEY;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'WALLET_ACCOUNT_XPUB is required in production: the server must not derive '
      + 'deposit addresses from WALLET_MNEMONIC. Export the xpub for m/44\'/60\'/0\'/0 '
      + 'on the offline machine.'
    );
  }
  return DEPOSIT_ADDRESS_DERIVATION_MODE_MASTER_MNEMONIC_DEVELOPMENT_ONLY;
}

export function deriveDepositAddressForDerivationIndex(derivationIndex) {
  const derivationPath = buildBip44DerivationPath(derivationIndex);
  const derivationMode = resolveDepositAddressDerivationMode();

  if (derivationMode === DEPOSIT_ADDRESS_DERIVATION_MODE_EXTENDED_PUBLIC_KEY) {
    const accountNode = ethers.HDNodeWallet.fromExtendedKey(
      resolveAccountExtendedPublicKey()
    );
    const derivedNode = accountNode.deriveChild(derivationIndex);
    return {
      address: derivedNode.address,
      derivationPath,
      derivationMode,
    };
  }

  // Development and tests only. The production guard in
  // config/productionSigningGuard.js refuses to start with a mnemonic, so this
  // branch can never be reached by a live server.
  return {
    ...deriveDepositAddressFromMasterMnemonicForDerivationIndex(derivationIndex),
    derivationMode,
  };
}
