import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  createAdminUserInDatabase,
} from '../controller/authController.js';

import {
  signTotpPendingToken,
  signFullAdminToken,
  verifyUserToken,
} from '../utils/tokenUtils.js';

import {
  generateCurrentTotpCode,
} from '../utils/totp.js';

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