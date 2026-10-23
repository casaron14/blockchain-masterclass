import { verifyUserToken } from '../utils/tokenUtils.js';

export const AUTH_REQUIRED = 'AUTH_REQUIRED';
export const FORBIDDEN = 'FORBIDDEN';

export function extractBearerTokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

export function createTokenVerificationMiddleware({
  requireAdmin = false,
  requireTotpVerified = false,
} = {}) {
  return async (req, res, next) => {
    const token = extractBearerTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ message: 'Authorization token missing' });
    }

    try {
      const decodedToken = verifyUserToken(token);
      req.user = decodedToken;
      if (requireAdmin && !decodedToken.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      if (requireTotpVerified && !decodedToken.totpVerified) {
        return res.status(403).json({ message: 'Second factor verification required' });
      }
      next();
    } catch (error) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
  };
}

export default createTokenVerificationMiddleware({ requireAdmin: false });