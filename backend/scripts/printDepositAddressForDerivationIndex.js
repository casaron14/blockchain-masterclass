import '../config/environment.js';

import { deriveDepositAddressForDerivationIndex } from '../services/depositAddressDerivationService.js';

const derivationIndexArgument = process.argv[2];
if (derivationIndexArgument === undefined) {
  console.error(
    'Usage: node scripts/printDepositAddressForDerivationIndex.js <derivation-index>'
  );
  process.exit(1);
}

const derivationIndex = Number(derivationIndexArgument);
const derivation = deriveDepositAddressForDerivationIndex(derivationIndex);

console.log(`mode:             ${derivation.derivationMode}`);
console.log(`derivation path:  ${derivation.derivationPath}`);
console.log(`address:          ${derivation.address}`);
