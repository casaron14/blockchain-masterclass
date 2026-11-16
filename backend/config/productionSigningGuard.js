export const PRODUCTION_SIGNING_GUARD_SKIPPED = 'PRODUCTION_SIGNING_GUARD_SKIPPED';
export const PRODUCTION_SIGNING_GUARD_PASSED = 'PRODUCTION_SIGNING_GUARD_PASSED';

/**
 * Refuses to boot a live server that still holds the deposit-address seed.
 *
 * Address derivation is the only reason the API process would need
 * WALLET_MNEMONIC. In production it derives from WALLET_ACCOUNT_XPUB instead,
 * so keeping this check at the process boundary means a forgotten environment
 * variable fails loudly at startup instead of quietly leaving the seed online.
 */
export function assertProductionSigningConfigurationIsSafe(
  environment = process.env
) {
  if (environment.NODE_ENV !== 'production') {
    return { status: PRODUCTION_SIGNING_GUARD_SKIPPED };
  }

  if (environment.WALLET_MNEMONIC) {
    throw new Error(
      'REFUSING TO START: WALLET_MNEMONIC is set in production. The seed must live '
      + 'only on the offline signing machine. Remove WALLET_MNEMONIC from the server '
      + 'environment and configure WALLET_ACCOUNT_XPUB instead.'
    );
  }

  if (!environment.WALLET_ACCOUNT_XPUB) {
    throw new Error(
      'REFUSING TO START: WALLET_ACCOUNT_XPUB is not configured. Export the xpub '
      + 'for m/44\'/60\'/0\'/0 on the offline machine and set it on the server.'
    );
  }

  return { status: PRODUCTION_SIGNING_GUARD_PASSED };
}
