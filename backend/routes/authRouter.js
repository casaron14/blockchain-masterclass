import express from "express";

import authController from "../controller/authController.js";
import { verifyTurnstileChallengeToken } from "../middleware/turnstileVerifier.js";
import { createStrictAuthRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.post(
  "/login",
  createStrictAuthRateLimiter(),
  verifyTurnstileChallengeToken,
  authController.loginExistingUser
);

router.post(
  "/verify-totp",
  createStrictAuthRateLimiter(),
  authController.verifyTotpCode
);

router.post(
  "/totp/setup",
  createStrictAuthRateLimiter(),
  authController.beginTotpSetup
);

router.post(
  "/totp/confirm",
  createStrictAuthRateLimiter(),
  authController.confirmTotpSetup
);

router.post("/logout", authController.logoutUserSession);

export default router;