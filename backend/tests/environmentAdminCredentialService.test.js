import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

import {
  isEnvironmentAdminConfigured,
  isEnvironmentAdminTotpRequired,
  readEnvironmentAdminPublicIdentity,
  verifyEnvironmentAdminCredentials,
  verifyEnvironmentAdminTotpCode,
} from '../services/environmentAdminCredentialService.js';

import { generateCurrentTotpCode } from '../utils/totp.js';

const ADMIN_ENVIRONMENT_VARIABLE_NAMES = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_NAME',
  'ADMIN_EMAIL',
  'ADMIN_TOTP_SECRET',
];

const originalEnvironmentValues = new Map(
  ADMIN_ENVIRONMENT_VARIABLE_NAMES.map((variableName) => [
    variableName,
    process.env[variableName],
  ])
);

function clearAdminEnvironmentVariables() {
  for (const variableName of ADMIN_ENVIRONMENT_VARIABLE_NAMES) {
    delete process.env[variableName];
  }
}

beforeEach(clearAdminEnvironmentVariables);

after(() => {
  for (const [variableName, originalValue] of originalEnvironmentValues) {
    if (originalValue === undefined) {
      delete process.env[variableName];
    } else {
      process.env[variableName] = originalValue;
    }
  }
});

test('isEnvironmentAdminConfigured requires a username and one password form', () => {
  assert.equal(isEnvironmentAdminConfigured(), false);

  process.env.ADMIN_USERNAME = 'deploy-admin';
  assert.equal(isEnvironmentAdminConfigured(), false);

  process.env.ADMIN_PASSWORD = 'a-long-enough-password';
  assert.equal(isEnvironmentAdminConfigured(), true);
});

test('verifyEnvironmentAdminCredentials accepts a bcrypt password hash', async () => {
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('correct-horse-battery', 4);

  assert.equal(
    await verifyEnvironmentAdminCredentials('deploy-admin', 'correct-horse-battery'),
    true
  );
  assert.equal(
    await verifyEnvironmentAdminCredentials('deploy-admin', 'wrong-password'),
    false
  );
  assert.equal(
    await verifyEnvironmentAdminCredentials('someone-else', 'correct-horse-battery'),
    false
  );
});

test('verifyEnvironmentAdminCredentials accepts a plain ADMIN_PASSWORD value', async () => {
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD = 'plain-password-value';

  assert.equal(
    await verifyEnvironmentAdminCredentials('deploy-admin', 'plain-password-value'),
    true
  );
  assert.equal(await verifyEnvironmentAdminCredentials('deploy-admin', 'nope'), false);
});

test('verifyEnvironmentAdminCredentials fails closed on a malformed bcrypt hash', async () => {
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD_HASH = 'not-a-bcrypt-hash';

  assert.equal(
    await verifyEnvironmentAdminCredentials('deploy-admin', 'anything'),
    false
  );
});

test('readEnvironmentAdminPublicIdentity never exposes password material', () => {
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD = 'plain-password-value';
  process.env.ADMIN_NAME = 'Event Administrator';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  const publicIdentity = readEnvironmentAdminPublicIdentity();

  assert.equal(publicIdentity.username, 'deploy-admin');
  assert.equal(publicIdentity.name, 'Event Administrator');
  assert.equal(publicIdentity.email, 'admin@example.com');
  assert.equal(publicIdentity.totp_configured, true);
  assert.equal(publicIdentity.credential_source, 'environment');
  assert.equal(publicIdentity.password, undefined);
  assert.equal(publicIdentity.passwordHash, undefined);
});

test('ADMIN_TOTP_SECRET enables and verifies the second factor', () => {
  const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD = 'plain-password-value';
  process.env.ADMIN_TOTP_SECRET = totpSecret;

  assert.equal(isEnvironmentAdminTotpRequired(), true);
  assert.equal(
    verifyEnvironmentAdminTotpCode(generateCurrentTotpCode(totpSecret)),
    true
  );
  assert.equal(verifyEnvironmentAdminTotpCode('000000'), false);
});
