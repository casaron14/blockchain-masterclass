import { createTokenVerificationMiddleware } from './authmiddleware.js';

const requireAdminAccess = createTokenVerificationMiddleware({
  requireAdmin: true,
  requireTotpVerified: true,
});

export default requireAdminAccess;