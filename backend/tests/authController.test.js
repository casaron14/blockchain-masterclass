import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  createAdminUserInDatabase,
} from '../controller/authController.js';
import authController from '../controller/authController.js';
import bcrypt from 'bcrypt';

import {
  signTotpPendingToken,
  signFullAdminToken,
  verifyUserToken,
} from '../utils/tokenUtils.js';

import {
  generateCurrentTotpCode,
} from '../utils/totp.js';

const ENVIRONMENT_ADMIN_VARIABLE_NAMES = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_TOTP_SECRET',
];

function clearEnvironmentAdminVariables() {
  for (const variableName of ENVIRONMENT_ADMIN_VARIABLE_NAMES) {
    delete process.env[variableName];
  }
}

function createMockLoginResponse() {
  const capturedResponse = {
    statusCode: null,
    body: null,
    jwtCookie: null,
  };

  return {
    status(statusCode) {
      capturedResponse.statusCode = statusCode;
      return this;
    },
    json(body) {
      capturedResponse.body = body;
      return this;
    },
    cookie(cookieName, cookieValue) {
      capturedResponse.jwtCookie = { cookieName, cookieValue };
      return this;
    },
    capturedResponse,
  };
}

async function resetUsersTable() {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
}

beforeEach(resetUsersTable);

after(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE').catch(() => {});
});

test('createAdminUserInDatabase stores the admin flag and hides the password hash', async () => {
  const createdAdmin = await createAdminUserInDatabase({
    name: 'Test Admin',
    username: 'testadmin',
    email: 'admin@example.com',
    password: 'very-secret-password',
  });

  assert.equal(createdAdmin.is_admin, true);
  assert.equal(createdAdmin.username, 'testadmin');
  assert.equal(createdAdmin.hashed_password, undefined);
  assert.equal(createdAdmin.totp_secret, undefined);
});

test('signFullAdminToken verifies with the isAdmin flag for the admin middleware', () => {
  const fullAdminToken = signFullAdminToken(1, true);
  const decodedToken = verifyUserToken(fullAdminToken);

  assert.equal(decodedToken.isAdmin, true);
  assert.equal(decodedToken.totpVerified, true);
  assert.equal(decodedToken.totpPending, undefined);
});

test('signTotpPendingToken produces a totpPending token that is not totpVerified', () => {
  const pendingToken = signTotpPendingToken(1, true);
  const decodedToken = verifyUserToken(pendingToken);

  assert.equal(decodedToken.totpPending, true);
  assert.equal(decodedToken.totpVerified, undefined);
});

test('generateCurrentTotpCode works with the secret returned by createAdminUserInDatabase', async () => {
  const createdAdmin = await createAdminUserInDatabase({
    name: 'Totp Admin',
    username: 'totpadmin',
    email: 'totp-admin@example.com',
    password: 'another-secret-password',
  });

  const updatedUser = await pool.query(
    'UPDATE users SET totp_secret = $1, totp_enabled = true WHERE id = $2 RETURNING *',
    ['GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', createdAdmin.id]
  );

  const currentCode = generateCurrentTotpCode(updatedUser.rows[0].totp_secret, 59 * 1000);
  assert.equal(currentCode, '287082');
});

test('loginExistingUser signs in the environment admin directly when TOTP is not configured', async () => {
  clearEnvironmentAdminVariables();
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('deployment-password', 4);

  const response = createMockLoginResponse();
  try {
    await authController.loginExistingUser(
      { body: { username: 'deploy-admin', password: 'deployment-password' } },
      response
    );

    assert.equal(response.capturedResponse.statusCode, 200);
    assert.ok(response.capturedResponse.body.token);
    assert.equal(response.capturedResponse.body.user.username, 'deploy-admin');
    assert.equal(response.capturedResponse.body.user.credential_source, 'environment');
    assert.equal(response.capturedResponse.jwtCookie.cookieName, 'jwt');

    const decodedToken = verifyUserToken(response.capturedResponse.body.token);
    assert.equal(decodedToken.isAdmin, true);
    assert.equal(decodedToken.totpVerified, true);
    assert.equal(decodedToken.credentialSource, 'environment');
  } finally {
    clearEnvironmentAdminVariables();
  }
});

test('loginExistingUser does not fall back to the users table when the environment admin is configured', async () => {
  clearEnvironmentAdminVariables();
  await createAdminUserInDatabase({
    name: 'Database Admin',
    username: 'database-admin',
    email: 'database-admin@example.com',
    password: 'database-password',
  });

  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD = 'deployment-password';

  const response = createMockLoginResponse();
  try {
    await authController.loginExistingUser(
      { body: { username: 'database-admin', password: 'database-password' } },
      response
    );

    assert.equal(response.capturedResponse.statusCode, 401);
    assert.equal(response.capturedResponse.body.token, undefined);
  } finally {
    clearEnvironmentAdminVariables();
  }
});

test('the environment admin completes TOTP verification with ADMIN_TOTP_SECRET', async () => {
  clearEnvironmentAdminVariables();
  const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  process.env.ADMIN_USERNAME = 'deploy-admin';
  process.env.ADMIN_PASSWORD = 'deployment-password';
  process.env.ADMIN_TOTP_SECRET = totpSecret;

  try {
    const loginResponse = createMockLoginResponse();
    await authController.loginExistingUser(
      { body: { username: 'deploy-admin', password: 'deployment-password' } },
      loginResponse
    );

    assert.equal(loginResponse.capturedResponse.body.totpConfigured, true);
    assert.ok(loginResponse.capturedResponse.body.temporaryToken);
    assert.equal(loginResponse.capturedResponse.body.token, undefined);

    const verificationResponse = createMockLoginResponse();
    await authController.verifyTotpCode(
      {
        body: {
          temporaryToken: loginResponse.capturedResponse.body.temporaryToken,
          code: generateCurrentTotpCode(totpSecret),
        },
      },
      verificationResponse
    );

    assert.equal(verificationResponse.capturedResponse.statusCode, 200);
    assert.ok(verificationResponse.capturedResponse.body.token);
    assert.equal(
      verifyUserToken(verificationResponse.capturedResponse.body.token).credentialSource,
      'environment'
    );
  } finally {
    clearEnvironmentAdminVariables();
  }
});