import jwt from 'jsonwebtoken';

export const FULL_ADMIN_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '8h';

export const TOTP_PENDING_TOKEN_EXPIRY = '5m';

export function readJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return process.env.JWT_SECRET;
}

export function signUserToken(tokenPayload, expiresIn = FULL_ADMIN_TOKEN_EXPIRY) {
  return jwt.sign(tokenPayload, readJwtSecret(), { expiresIn });
}

export function verifyUserToken(token) {
  return jwt.verify(token, readJwtSecret());
}

export function signTotpPendingToken(userId, isAdmin, credentialSource = 'database') {
  return signUserToken(
    { id: userId, isAdmin, credentialSource, totpPending: true },
    TOTP_PENDING_TOKEN_EXPIRY
  );
}

export function signFullAdminToken(userId, isAdmin, credentialSource = 'database') {
  return signUserToken({
    id: userId,
    isAdmin,
    credentialSource,
    totpVerified: true,
  });
}

export function setJwtCookie(response, token) {
  response.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearJwtCookie(response) {
  response.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
  });
}