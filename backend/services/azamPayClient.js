import crypto from 'node:crypto';

import { LOCAL_CURRENCY_CODE } from './eventConfigService.js';

const AZAMPAY_AUTH_SANDBOX_URL = 'https://authenticator-sandbox.azampay.co.tz';
const AZAMPAY_AUTH_PRODUCTION_URL = 'https://authenticator.azampay.co.tz';
const AZAMPAY_CHECKOUT_SANDBOX_URL = 'https://sandbox.azampay.co.tz';
const AZAMPAY_CHECKOUT_PRODUCTION_URL = 'https://checkout.azampay.co.tz';

const isProductionMode = () => process.env.AZAMPAY_MODE === 'production';

export function resolveAzamPayAuthBaseUrl() {
  if (process.env.AZAMPAY_AUTH_BASE_URL) {
    return process.env.AZAMPAY_AUTH_BASE_URL;
  }
  return isProductionMode()
    ? AZAMPAY_AUTH_PRODUCTION_URL
    : AZAMPAY_AUTH_SANDBOX_URL;
}

export function resolveAzamPayCheckoutBaseUrl() {
  if (process.env.AZAMPAY_CHECKOUT_BASE_URL) {
    return process.env.AZAMPAY_CHECKOUT_BASE_URL;
  }
  return isProductionMode()
    ? AZAMPAY_CHECKOUT_PRODUCTION_URL
    : AZAMPAY_CHECKOUT_SANDBOX_URL;
}

export function formatTanzanianPhoneNumberForAzamPay(phoneNumber) {
  const digitsOnly = String(phoneNumber).replace(/[^0-9]/g, '');
  if (digitsOnly.startsWith('255')) {
    return `255${digitsOnly.slice(3)}`;
  }
  return `255${digitsOnly.replace(/^0/, '')}`;
}

export function resolveAzamPayApiKey() {
  return process.env.AZAMPAY_API_KEY || process.env.AZAMPAY_TOKEN || null;
}

export function generateAzamPayExternalId() {
  return crypto.randomUUID();
}

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0;

async function generateAzamPayAccessToken() {
  const currentTimeMs = Date.now();
  if (cachedAccessToken && currentTimeMs < cachedAccessTokenExpiryMs - 30000) {
    return cachedAccessToken;
  }

  const response = await fetch(`${resolveAzamPayAuthBaseUrl()}/AppRegistration/GenerateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appName: process.env.AZAMPAY_APP_NAME,
      clientId: process.env.AZAMPAY_CLIENT_ID,
      clientSecret: process.env.AZAMPAY_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`AzamPay token request failed with status ${response.status}`);
  }

  const tokenResponse = await response.json();
  const accessToken = tokenResponse.data?.accessToken;
  if (!accessToken) {
    throw new Error('AzamPay token response did not include an access token');
  }

  cachedAccessToken = accessToken;
  cachedAccessTokenExpiryMs = new Date(tokenResponse.data.expire).getTime();
  return accessToken;
}

export async function initiateAzamPayMobileCheckout(phoneNumber, amountInTzs, externalId) {
  const accessToken = await generateAzamPayAccessToken();
  const formattedPhoneNumber = formatTanzanianPhoneNumberForAzamPay(phoneNumber);
  const azamPayApiKey = resolveAzamPayApiKey();

  const checkoutHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  if (azamPayApiKey) {
    checkoutHeaders['X-API-Key'] = azamPayApiKey;
  }

  const response = await fetch(`${resolveAzamPayCheckoutBaseUrl()}/azampay/mno/checkout`, {
    method: 'POST',
    headers: checkoutHeaders,
    body: JSON.stringify({
      accountNumber: formattedPhoneNumber,
      amount: String(amountInTzs),
      currency: LOCAL_CURRENCY_CODE,
      provider: 'Azampesa',
      externalId,
      additionalProperties: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`AzamPay checkout request failed with status ${response.status}`);
  }

  return response.json();
}
