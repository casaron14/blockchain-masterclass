import express from "express";
import paymentController from "../controller/paymentController.js";
import offlinePaymentController from "../controller/offlinePaymentController.js";
import { receiveSingleOfflinePaymentReceiptFile } from "../middleware/offlinePaymentReceiptUploadMiddleware.js";
import {
  createStrictPaymentInitiationRateLimiter,
  createGeneralRequestRateLimiter,
} from "../middleware/rateLimiter.js";
import { preventSensitiveResponseCaching } from "../middleware/httpSecurityMiddleware.js";

const router = express.Router();

router.use(preventSensitiveResponseCaching);

router.post(
  "/",
  createStrictPaymentInitiationRateLimiter(),
  paymentController.createPaymentRecord
);

// The URL segment is payments.public_token, never the sequential payments.id.
// A numeric segment therefore resolves to nothing and returns 404.
router.get(
  "/:paymentPublicToken",
  createGeneralRequestRateLimiter(),
  paymentController.getPaymentRecordByPublicToken
);

router.post(
  "/:paymentPublicToken/verify-usdt",
  createStrictPaymentInitiationRateLimiter(),
  paymentController.verifyUsdtPaymentEndpoint
);

router.post(
  "/:paymentPublicToken/initiate-usdt",
  createStrictPaymentInitiationRateLimiter(),
  paymentController.initiateUsdtPaymentEndpoint
);

router.post(
  "/:paymentPublicToken/lipanamba-receipt",
  createStrictPaymentInitiationRateLimiter(),
  receiveSingleOfflinePaymentReceiptFile,
  offlinePaymentController.uploadLipaNambaPaymentReceiptEndpoint
);

export default router;
