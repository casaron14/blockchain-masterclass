import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBip44DerivationPath,
  deriveDepositAddressFromMasterMnemonicForDerivationIndex,
} from '../services/signingService.js';

test('buildBip44DerivationPath produces the BIP44 BSC/EVM path for an index', () => {
  assert.equal(buildBip44DerivationPath(0), "m/44'/60'/0'/0/0");
  assert.equal(buildBip44DerivationPath(7), "m/44'/60'/0'/0/7");
  assert.equal(buildBip44DerivationPath(123456), "m/44'/60'/0'/0/123456");
});

test('buildBip44DerivationPath rejects non-integer and negative indices', () => {
  assert.throws(() => buildBip44DerivationPath(-1));
  assert.throws(() => buildBip44DerivationPath(1.5));
  assert.throws(() => buildBip44DerivationPath('5'));
  assert.throws(() => buildBip44DerivationPath(undefined));
});

test('the development-only mnemonic derivation is stable per index', () => {
  const firstDerivation = deriveDepositAddressFromMasterMnemonicForDerivationIndex(0);
  const secondDerivation = deriveDepositAddressFromMasterMnemonicForDerivationIndex(0);
  const otherIndexDerivation = deriveDepositAddressFromMasterMnemonicForDerivationIndex(1);

  assert.equal(firstDerivation.address, secondDerivation.address);
  assert.equal(firstDerivation.derivationPath, "m/44'/60'/0'/0/0");
  assert.notEqual(firstDerivation.address, otherIndexDerivation.address);
  assert.match(firstDerivation.address, /^0x[a-fA-F0-9]{40}$/);
});
