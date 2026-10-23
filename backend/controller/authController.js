import bcrypt from 'bcrypt';
import QRCode from 'qrcode';

import pool from '../config/db.js';

import {
  signTotpPendingToken,
  signFullAdminToken,
  verifyUserToken,
  setJwtCookie,
  clearJwtCookie,
} from '../utils/tokenUtils.js';

import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotpCodeAgainstSecret,
} from '../utils/totp.js';

function sanitizeUserRecord(userRecord) {
  if (!userRecord) {
    return null;
  }
  const { hashed_password: hashedPassword, totp_secret: totpSecret, ...safeUserFields } = userRecord;
  return safeUserFields;
}

async function findUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0] ?? null;
}

async function findUserById(userId) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function createAdminUserInDatabase({ name, username, email, password }) {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const result = await pool.query(
    `INSERT INTO users (name, username, email, hashed_password, is_admin)
     VALUES ($1, $2, $3, $4, true)
     RETURNING *`,
    [name, username, email, hashedPassword]
  );

  return sanitizeUserRecord(result.rows[0]);
}

const loginExistingUser = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: 'Username and password are required' });
  }

  const userRecord = await findUserByUsername(username);
  if (!userRecord) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const isPasswordValid = await bcrypt.compare(password, userRecord.hashed_password);
  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (!userRecord.is_admin) {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const temporaryToken = signTotpPendingToken(userRecord.id, userRecord.is_admin);

  res.status(200).json({
    message: 'Credentials verified, second factor required',
    temporaryToken,
    totpConfigured: userRecord.totp_enabled,
  });
};

const verifyTotpCode = async (req, res) => {
  const { temporaryToken, code } = req.body;

  if (!temporaryToken || !code) {
    return res
      .status(400)
      .json({ message: 'Temporary token and code are required' });
  }

  let decodedTemporaryToken;
  try {
    decodedTemporaryToken = verifyUserToken(temporaryToken);
  } catch {
    return res
      .status(403)
      .json({ message: 'Temporary token invalid or expired' });
  }

  if (!decodedTemporaryToken.totpPending) {
    return res
      .status(403)
      .json({ message: 'Temporary token is not a pending login token' });
  }

  const userRecord = await findUserById(decodedTemporaryToken.id);
  if (!userRecord || !userRecord.totp_enabled || !userRecord.totp_secret) {
    return res
      .status(403)
      .json({ message: 'Two-factor authentication is not configured' });
  }

  const isCodeValid = verifyTotpCodeAgainstSecret(userRecord.totp_secret, code);
  if (!isCodeValid) {
    return res.status(401).json({ message: 'Invalid authentication code' });
  }

  const fullToken = signFullAdminToken(userRecord.id, userRecord.is_admin);
  setJwtCookie(res, fullToken);

  res.status(200).json({ message: 'Login successful', token: fullToken, user: sanitizeUserRecord(userRecord) });
};

const beginTotpSetup = async (req, res) => {
  const { temporaryToken } = req.body;

  if (!temporaryToken) {
    return res
      .status(400)
      .json({ message: 'Temporary token is required' });
  }

  let decodedTemporaryToken;
  try {
    decodedTemporaryToken = verifyUserToken(temporaryToken);
  } catch {
    return res
      .status(403)
      .json({ message: 'Temporary token invalid or expired' });
  }

  if (!decodedTemporaryToken.totpPending) {
    return res
      .status(403)
      .json({ message: 'Temporary token is not a pending login token' });
  }

  const userRecord = await findUserById(decodedTemporaryToken.id);
  if (!userRecord) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (userRecord.totp_enabled) {
    return res.status(409).json({ message: 'Two-factor authentication is already configured' });
  }

  const newSecret = generateTotpSecret();
  await pool.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [newSecret, userRecord.id]);

  const otpauthUrl = buildOtpauthUrl(userRecord.username, newSecret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240 });

  res.status(200).json({ otpauthUrl, qrCodeDataUrl, secret: newSecret });
};

const confirmTotpSetup = async (req, res) => {
  const { temporaryToken, code } = req.body;

  if (!temporaryToken || !code) {
    return res
      .status(400)
      .json({ message: 'Temporary token and code are required' });
  }

  let decodedTemporaryToken;
  try {
    decodedTemporaryToken = verifyUserToken(temporaryToken);
  } catch {
    return res
      .status(403)
      .json({ message: 'Temporary token invalid or expired' });
  }

  if (!decodedTemporaryToken.totpPending) {
    return res
      .status(403)
      .json({ message: 'Temporary token is not a pending login token' });
  }

  const userRecord = await findUserById(decodedTemporaryToken.id);
  if (!userRecord || !userRecord.totp_secret) {
    return res
      .status(409)
      .json({ message: 'TOTP setup has not been started' });
  }

  const isCodeValid = verifyTotpCodeAgainstSecret(userRecord.totp_secret, code);
  if (!isCodeValid) {
    return res.status(401).json({ message: 'Invalid authentication code' });
  }

  await pool.query(
    "UPDATE users SET totp_enabled = true WHERE id = $1",
    [userRecord.id]
  );

  const fullToken = signFullAdminToken(userRecord.id, userRecord.is_admin);
  setJwtCookie(res, fullToken);

  res.status(200).json({ message: 'Two-factor authentication enabled', token: fullToken, user: sanitizeUserRecord(userRecord) });
};

const logoutUserSession = async (req, res) => {
  clearJwtCookie(res);
  res.status(200).json({ message: 'Logout successful' });
};

export default {
  loginExistingUser,
  verifyTotpCode,
  beginTotpSetup,
  confirmTotpSetup,
  logoutUserSession,
  createAdminUserInDatabase,
};