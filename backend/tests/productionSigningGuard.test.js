import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCTION_SIGNING_GUARD_PASSED,
  PRODUCTION_SIGNING_GUARD_SKIPPED,
  assertProductionSigningConfigurationIsSafe,
} from '../config/productionSigningGuard.js';

const VALID_XPUB =
  'xpub6DyUKdwoLWmUJ4Tn6hJ7vQcJ8g5rWq5c8h4t9k2m3n4p5q6r7s8t9u0v1w2x3y4z5a6b7c8d9e0f1g2h3';

test('the guard is a no-op outside production', () => {
  assert.equal(
    assertProductionSigningConfigurationIsSafe({ NODE_ENV: 'development' }).status,
    PRODUCTION_SIGNING_GUARD_SKIPPED
  );
  assert.equal(
    assertProductionSigningConfigurationIsSafe({ NODE_ENV: 'test' }).status,
    PRODUCTION_SIGNING_GUARD_SKIPPED
  );
});

test('production refuses to boot while WALLET_MNEMONIC is present', () => {
  assert.throws(
    () => assertProductionSigningConfigurationIsSafe({
      NODE_ENV: 'production',
      WALLET_MNEMONIC: 'test test test test test test test test test test test junk',
      WALLET_ACCOUNT_XPUB: VALID_XPUB,
    }),
    /WALLET_MNEMONIC is set in production/
  );
});

test('production requires WALLET_ACCOUNT_XPUB', () => {
  assert.throws(
    () => assertProductionSigningConfigurationIsSafe({
      NODE_ENV: 'production',
      ENABLE_SWEEP_JOB: 'false',
    }),
    /WALLET_ACCOUNT_XPUB is not configured/
  );
});

test('production refuses the in-process sweep job', () => {
  assert.throws(
    () => assertProductionSigningConfigurationIsSafe({
      NODE_ENV: 'production',
      WALLET_ACCOUNT_XPUB: VALID_XPUB,
      ENABLE_SWEEP_JOB: 'true',
    }),
    /ENABLE_SWEEP_JOB is enabled in production/
  );
});

test('a production server with an xpub and offline sweeps passes', () => {
  assert.equal(
    assertProductionSigningConfigurationIsSafe({
      NODE_ENV: 'production',
      WALLET_ACCOUNT_XPUB: VALID_XPUB,
      ENABLE_SWEEP_JOB: 'false',
    }).status,
    PRODUCTION_SIGNING_GUARD_PASSED
  );
});
