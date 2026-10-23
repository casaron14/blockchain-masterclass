import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import {
  DEPOSIT_ADDRESS_DERIVATION_MODE_EXTENDED_PUBLIC_KEY,
  DEPOSIT_ADDRESS_DERIVATION_MODE_MASTER_MNEMONIC_DEVELOPMENT_ONLY,
  deriveDepositAddressForDerivationIndex,
  resolveDepositAddressDerivationMode,
} from '../services/depositAddressDerivationService.js';

import {
  deriveDepositAddressFromMasterMnemonicForDerivationIndex,
} from '../services/signingService.js';

const ORIGINAL_ACCOUNT_EXTENDED_PUBLIC_KEY = process.env.WALLET_ACCOUNT_XPUB;
const ORIGINAL_NODE_ENVIRONMENT = process.env.NODE_ENV;

function restoreDerivationEnvironment() {
  if (ORIGINAL_ACCOUNT_EXTENDED_PUBLIC_KEY === undefined) {
    delete process.env.WALLET_ACCOUNT_XPUB;
  } else {
    process.env.WALLET_ACCOUNT_XPUB = ORIGINAL_ACCOUNT_EXTENDED_PUBLIC_KEY;
  }
  if (ORIGINAL_NODE_ENVIRONMENT === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENVIRONMENT;
  }
}

function buildAccountExtendedPublicKeyFromConfiguredMnemonic() {
  return ethers.HDNodeWallet.fromPhrase(
    process.env.WALLET_MNEMONIC,
    undefined,
    'm'
  ).derivePath("m/44'/60'/0'/0").neuter().extendedKey;
}

test('the xpub for m/44\'/60\'/0\'/0 derives exactly the mnemonic addresses', () => {
  const accountExtendedPublicKey = buildAccountExtendedPublicKeyFromConfiguredMnemonic();
  const mnemonicAddresses = [0, 1, 7, 2077].map(
    (derivationIndex) =>
      deriveDepositAddressFromMasterMnemonicForDerivationIndex(derivationIndex).address
  );

  process.env.WALLET_ACCOUNT_XPUB = accountExtendedPublicKey;
  try {
    assert.equal(
      resolveDepositAddressDerivationMode(),
      DEPOSIT_ADDRESS_DERIVATION_MODE_EXTENDED_PUBLIC_KEY
    );
    const xpubAddresses = [0, 1, 7, 2077].map(
      (derivationIndex) =>
        deriveDepositAddressForDerivationIndex(derivationIndex).address
    );
    assert.deepEqual(xpubAddresses, mnemonicAddresses);
  } finally {
    restoreDerivationEnvironment();
  }
});

test('the xpub path reports the same BIP44 derivation path as before', () => {
  process.env.WALLET_ACCOUNT_XPUB = buildAccountExtendedPublicKeyFromConfiguredMnemonic();
  try {
    const derivation = deriveDepositAddressForDerivationIndex(42);
    assert.equal(derivation.derivationPath, "m/44'/60'/0'/0/42");
    assert.equal(
      derivation.derivationMode,
      DEPOSIT_ADDRESS_DERIVATION_MODE_EXTENDED_PUBLIC_KEY
    );
  } finally {
    restoreDerivationEnvironment();
  }
});

test('without an xpub, development falls back to the local mnemonic', () => {
  delete process.env.WALLET_ACCOUNT_XPUB;
  process.env.NODE_ENV = 'test';
  try {
    assert.equal(
      resolveDepositAddressDerivationMode(),
      DEPOSIT_ADDRESS_DERIVATION_MODE_MASTER_MNEMONIC_DEVELOPMENT_ONLY
    );
    assert.match(
      deriveDepositAddressForDerivationIndex(0).address,
      /^0x[a-fA-F0-9]{40}$/
    );
  } finally {
    restoreDerivationEnvironment();
  }
});

test('production refuses to derive addresses without an xpub', () => {
  delete process.env.WALLET_ACCOUNT_XPUB;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => deriveDepositAddressForDerivationIndex(0),
      /WALLET_ACCOUNT_XPUB is required in production/
    );
  } finally {
    restoreDerivationEnvironment();
  }
});

test('an invalid xpub is rejected instead of deriving an unrecoverable address', () => {
  process.env.WALLET_ACCOUNT_XPUB = 'xpub-not-a-real-key';
  try {
    assert.throws(() => deriveDepositAddressForDerivationIndex(0));
  } finally {
    restoreDerivationEnvironment();
  }
});
