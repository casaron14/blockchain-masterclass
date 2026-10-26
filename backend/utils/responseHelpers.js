

export function validationFailedResponse(error) {
  return {
    message: 'Validation failed',
    error: error.details[0].message,
  };
}

export function soldOutResponse(seatsRemaining = 0) {
  return {
    message: 'Event is sold out',
    seatsRemaining,
  };
}

export function paymentMethodNotFoundResponse(method) {
  return {
    message: `Payment method is not ${method}`,
  };
}

export function missingRequiredFieldResponse(field) {
  return {
    message: `Missing required field: ${field}`,
  };
}

export function bookingNotFoundResponse() {
  return {
    message: 'Booking not found',
  };
}

export function invalidBookingSearchValueResponse(searchErrorMessage) {
  return {
    message: searchErrorMessage,
    error: 'INVALID_BOOKING_SEARCH_VALUE',
  };
}

export function ambiguousBookingLookupResponse(matchingBookingCount) {
  return {
    message:
      'More than one booking matches that search. Use the booking reference to identify one booking.',
    error: 'AMBIGUOUS_BOOKING_LOOKUP',
    matchingBookingCount,
  };
}

export function paymentNotFoundResponse() {
  return {
    message: 'Payment not found',
  };
}

export function userNotFoundResponse() {
  return {
    message: 'User not found',
  };
}

export function eventNotFoundResponse() {
  return {
    message: 'Event not found',
  };
}

export function ticketNotFoundResponse() {
  return {
    message: 'Booking not found for redelivery',
  };
}

export function azamPayInvalidMethodResponse() {
  return paymentMethodNotFoundResponse('AzamPesa');
}

export function usdtInvalidMethodResponse() {
  return paymentMethodNotFoundResponse('USDT (BEP20)');
}

export function adminPaymentNotFoundResponse() {
  return {
    message: 'A payment record does not exist for this booking',
  };
}

export function adminBookingStatusInvalidResponse(status) {
  return {
    message: `Invalid booking status: ${status}`,
  };
}

export function temporaryTokenInvalidResponse() {
  return {
    message: 'Temporary token invalid or expired',
  };
}

export function totpNotConfiguredResponse() {
  return {
    message: 'Two-factor authentication is not configured',
  };
}

export function totpAlreadyConfiguredResponse() {
  return {
    message: 'Two-factor authentication is already configured',
  };
}

export function totpSetupNotStartedResponse() {
  return {
    message: 'TOTP setup has not been started',
  };
}

export function orderAlreadyExistsResponse() {
  return {
    message: 'An order already exists for this booking',
  };
}

export function azamPayHoldExpiredResponse() {
  return {
    message: 'Hold has expired, please rebook',
  };
}

export function usdtPaymentNotFoundResponse() {
  return {
    message: 'A payment record does not exist for this booking',
  };
}

export function usdtAlreadyConfirmedResponse() {
  return {
    message: 'Payment already confirmed',
  };
}

export function wrongReceiverResponse() {
  return {
    message: 'Wrong receiver',
  };
}

export function amountUnderpaidResponse() {
  return {
    message: 'Amount underpaid',
  };
}

export function notEnoughConfirmationsResponse() {
  return {
    message: 'Not enough confirmations',
  };
}

export function transactionNotFoundResponse() {
  return {
    message: 'Transaction not found',
  };
}

export function usdtTransferNotFoundResponse() {
  return {
    message: 'USDT transfer not found',
  };
}

export function invalidPaymentMethodResponse(method) {
  return {
    message: `Invalid payment method: ${method}`,
  };
}

export function paymentMethodNotAvailableResponse(method) {
  return {
    message: `Payment method is not available: ${method}`,
    error: 'PAYMENT_METHOD_NOT_AVAILABLE',
  };
}

export function corsOriginNotAllowedResponse() {
  return {
    message: 'Origin not allowed by CORS policy',
  };
}

export function payloadTooLargeResponse() {
  return {
    message: 'Request body too large',
    error: 'PAYLOAD_TOO_LARGE',
  };
}

export function invalidJsonBodyResponse() {
  return {
    message: 'Request body is not valid JSON',
  };
}

export function internalServerErrorResponse() {
  return {
    message: 'Internal server error',
    error: 'INTERNAL_ERROR',
  };
}