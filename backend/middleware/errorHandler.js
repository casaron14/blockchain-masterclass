import Joi from 'joi';
import {
  validationFailedResponse,
  soldOutResponse,
  bookingNotFoundResponse,
  paymentNotFoundResponse,
  azamPayInvalidMethodResponse,
  usdtInvalidMethodResponse,
  adminBookingStatusInvalidResponse,
  temporaryTokenInvalidResponse,
  totpNotConfiguredResponse,
  totpAlreadyConfiguredResponse,
  totpSetupNotStartedResponse,
  orderAlreadyExistsResponse,
  azamPayHoldExpiredResponse,
  usdtPaymentNotFoundResponse,
  usdtAlreadyConfirmedResponse,
  wrongReceiverResponse,
  amountUnderpaidResponse,
  notEnoughConfirmationsResponse,
  transactionNotFoundResponse,
  usdtTransferNotFoundResponse,
  corsOriginNotAllowedResponse,
  payloadTooLargeResponse,
  invalidJsonBodyResponse,
  internalServerErrorResponse,
} from '../utils/responseHelpers.js';

function isDevelopmentEnvironment() {
  return process.env.NODE_ENV !== 'production';
}

function resolveSafeErrorMessage(err) {
  if (isDevelopmentEnvironment()) {
    return err.message;
  }
  return 'Internal server error';
}

export function handleNotFoundRoute(req, res) {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    error: 'NOT_FOUND',
  });
}

const handleApplicationError = (err, req, res, next) => {
  console.error('Unhandled application error:', err.stack || err.message);

  if (err.type === 'entity.too.large') {
    return res.status(413).json(payloadTooLargeResponse());
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(invalidJsonBodyResponse());
  }

  if (err instanceof Joi.ValidationError) {
    return res.status(400).json(validationFailedResponse(err));
  }

  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json({
      message: err.expose ? err.message : 'Request could not be completed',
      error: err.code || 'REQUEST_ERROR',
    });
  }

  if (err.message === 'CORS_ORIGIN_NOT_ALLOWED') {
    return res.status(403).json(corsOriginNotAllowedResponse());
  }

  if (err.code === 'SOLD_OUT') {
    return res.status(400).json(soldOutResponse(err.seatsRemaining));
  }

  if (err.message === 'AZAMPESA_HOLD_EXPIRED') {
    return res.status(409).json(azamPayHoldExpiredResponse());
  }

  if (err.message === 'AZAMPESA_INVALID_METHOD') {
    return res.status(400).json(azamPayInvalidMethodResponse());
  }

  if (err.message === 'AZAMPESA_PAYMENT_NOT_FOUND') {
    return res.status(404).json(paymentNotFoundResponse());
  }

  if (err.message === 'USDT_INVALID_METHOD') {
    return res.status(400).json(usdtInvalidMethodResponse());
  }

  if (err.message === 'USDT_PAYMENT_NOT_FOUND') {
    return res.status(404).json(usdtPaymentNotFoundResponse());
  }

  if (err.message === 'USDT_ALREADY_CONFIRMED') {
    return res.status(409).json(usdtAlreadyConfirmedResponse());
  }

  if (err.message === 'WRONG_RECEIVER') {
    return res.status(400).json(wrongReceiverResponse());
  }

  if (err.message === 'AMOUNT_UNDERPAID') {
    return res.status(400).json(amountUnderpaidResponse());
  }

  if (err.message === 'NOT_ENOUGH_CONFIRMATIONS') {
    return res.status(400).json(notEnoughConfirmationsResponse());
  }

  if (err.message === 'TRANSACTION_NOT_FOUND') {
    return res.status(404).json(transactionNotFoundResponse());
  }

  if (err.message === 'USDT_TRANSFER_NOT_FOUND') {
    return res.status(404).json(usdtTransferNotFoundResponse());
  }

  if (err.code === 'BOOKING_NOT_FOUND') {
    return res.status(404).json(bookingNotFoundResponse());
  }

  if (err.code === 'PAYMENT_NOT_FOUND') {
    return res.status(404).json(paymentNotFoundResponse());
  }

  if (err.code === 'BOOKING_NOT_EXPIRED') {
    return res.status(409).json({
      message: err.message,
    });
  }

  if (err.code === 'INVALID_BOOKING_STATUS') {
    return res.status(400).json(adminBookingStatusInvalidResponse(err.invalidStatus));
  }

  if (err.message === 'Temporary token invalid or expired') {
    return res.status(403).json(temporaryTokenInvalidResponse());
  }

  if (err.message === 'Two-factor authentication is not configured') {
    return res.status(403).json(totpNotConfiguredResponse());
  }

  if (err.message === 'Two-factor authentication is already configured') {
    return res.status(409).json(totpAlreadyConfiguredResponse());
  }

  if (err.message === 'TOTP setup has not been started') {
    return res.status(409).json(totpSetupNotStartedResponse());
  }

  if (err.message === 'An order already exists for booking') {
    return res.status(409).json(orderAlreadyExistsResponse());
  }

  return res.status(500).json(internalServerErrorResponse());
};

export default handleApplicationError;