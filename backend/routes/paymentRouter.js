import express from "express";
import paymentController from "../controller/paymentController.js";
import offlinePaymentController from "../controller/offlinePaymentController.js";
import { receiveSingleOfflinePaymentReceiptFile } from "../middleware/offlinePaymentReceiptUploadMiddleware.js";
import {
  createStrictPaymentInitiationRateLimiter,
  createGeneralRequestRateLimiter,
} from "../middleware/rateLimiter.js";
import { validatePositiveIntegerRouteParam } from "../middleware/requestValidators.js";

const router = express.Router();

router.post(
  "/",
  createStrictPaymentInitiationRateLimiter(),
  paymentController.createPaymentRecord
);

router.get(
  "/by-external/:externalId",
  createGeneralRequestRateLimiter(),
  paymentController.fetchPaymentStatusByExternalId
);

router.get(
  "/:id",
  createGeneralRequestRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  paymentController.getPaymentRecordById
);

router.post(
  "/:id/initiate-azampesa",
  createStrictPaymentInitiationRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  paymentController.initiateAzamPesaPaymentEndpoint
);

router.post(
  "/:id/verify-usdt",
  createStrictPaymentInitiationRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  paymentController.verifyUsdtPaymentEndpoint
);

router.post(
  "/:id/refresh-onchain",
  createGeneralRequestRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  paymentController.refreshUsdtPaymentObservationEndpoint
);

router.post(
  "/:id/initiate-usdt",
  createStrictPaymentInitiationRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  paymentController.initiateUsdtPaymentEndpoint
);

router.post(
  "/:id/lipanamba-receipt",
  createStrictPaymentInitiationRateLimiter(),
  validatePositiveIntegerRouteParam("id"),
  receiveSingleOfflinePaymentReceiptFile,
  offlinePaymentController.uploadLipaNambaPaymentReceiptEndpoint
);

export default router;