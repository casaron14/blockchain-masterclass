import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import { verifyTotpCodeAgainstSecret } from '../utils/totp.js';

// The deployed admin account is configured in Vercel instead of the users
// table. The environment is the single source of truth so a fresh Supabase
// database needs no seeding step: deploy, set the variables, sign in.
export const ENVIRONMENT_ADMIN_CREDENTIAL_SOURCE = 'environment';

export const ENVIRONMENT_ADMIN_USER_ID = 0;

const ADMIN_USERNAME_ENVIRONMENT_VARIABLE = 'ADMIN_USERNAME';
const ADMIN_PASSWORD_HASH_ENVIRONMENT_VARIABLE = 'ADMIN_PASSWORD_HASH';
const ADMIN_PASSWORD_ENVIRONMENT_VARIABLE = 'ADMIN_PASSWORD';
const ADMIN_TOTP_SECRET_ENVIRONMENT_VARIABLE = 'ADMIN_TOTP_SECRET';

function readConfiguredValue(variableName) {
  return process.env[variableName]?.trim() || '';
}

export function isEnvironmentAdminConfigured() {
  const configuredUsername = readConfiguredValue(ADMIN_USERNAME_ENVIRONMENT_VARIABLE);
  const configuredPasswordSecret =
    readConfiguredValue(ADMIN_PASSWORD_HASH_ENVIRONMENT_VARIABLE) ||
    readConfiguredValue(ADMIN_PASSWORD_ENVIRONMENT_VARIABLE);

  return Boolean(configuredUsername && configuredPasswordSecret);
}

export function isEnvironmentAdminTotpRequired() {
  return Boolean(readConfiguredValue(ADMIN_TOTP_SECRET_ENVIRONMENT_VARIABLE));
}

export function readEnvironmentAdminPublicIdentity() {
  return {
    id: ENVIRONMENT_ADMIN_USER_ID,
    username: readConfiguredValue(ADMIN_USERNAME_ENVIRONMENT_VARIABLE),
    name: readConfiguredValue('ADMIN_NAME') || 'Administrator',
    email: readConfiguredValue('ADMIN_EMAIL'),
    is_admin: true,
    credential_source: ENVIRONMENT_ADMIN_CREDENTIAL_SOURCE,
    totp_configured: isEnvironmentAdminTotpRequired(),
  };
}

function comparePlainTextValuesInConstantTime(firstValue, secondValue) {
  const firstDigest = crypto.createHash('sha256').update(String(firstValue)).digest();
  const secondDigest = crypto.createHash('sha256').update(String(secondValue)).digest();
  return crypto.timingSafeEqual(firstDigest, secondDigest);
}

async function verifyConfiguredAdminPassword(providedPassword) {
  const configuredPasswordHash = readConfiguredValue(
    ADMIN_PASSWORD_HASH_ENVIRONMENT_VARIABLE
  );

  if (configuredPasswordHash) {
    try {
      return await bcrypt.compare(providedPassword, configuredPasswordHash);
    } catch {
      // A malformed hash must fail closed instead of throwing a 500 that tells
      // the caller something about the deployment configuration.
      return false;
    }
  }

  return comparePlainTextValuesInConstantTime(
    providedPassword,
    readConfiguredValue(ADMIN_PASSWORD_ENVIRONMENT_VARIABLE)
  );
}

export async function verifyEnvironmentAdminCredentials(
  providedUsername,
  providedPassword
) {
  if (!isEnvironmentAdminConfigured()) {
    return false;
  }

  const usernameMatches = comparePlainTextValuesInConstantTime(
    String(providedUsername || '').trim(),
    readConfiguredValue(ADMIN_USERNAME_ENVIRONMENT_VARIABLE)
  );

  // Always run the password comparison so a wrong username costs the same as a
  // wrong password. Otherwise the response time reveals whether the username
  // guessed from the login form exists.
  const passwordMatches = await verifyConfiguredAdminPassword(
    String(providedPassword || '')
  );

  return usernameMatches && passwordMatches;
}

export function verifyEnvironmentAdminTotpCode(providedTotpCode) {
  return verifyTotpCodeAgainstSecret(
    readConfiguredValue(ADMIN_TOTP_SECRET_ENVIRONMENT_VARIABLE),
    providedTotpCode
  );
}
