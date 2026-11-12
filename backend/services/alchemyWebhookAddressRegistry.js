import { logError } from '../utils/applicationLogger.js';

export const ALCHEMY_NOTIFY_API_BASE_URL = 'https://dashboard.alchemy.com/api';
export const ALCHEMY_UPDATE_WEBHOOK_ADDRESSES_PATH = '/update-webhook-addresses';
export const ALCHEMY_WEBHOOK_REGISTRATION_TIMEOUT_MS = 5000;

export function isAlchemyWebhookAddressRegistryConfigured() {
  return Boolean(process.env.ALCHEMY_WEBHOOK_ID && process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN);
}

/**
 * Adds one derived deposit address to the Alchemy Address Activity webhook.
 *
 * Detection does not depend on this call being delivered: the listener still
 * scans the chain for the USDT contract and attributes transfers in SQL. The
 * webhook only shortens the time between the transfer and the record, so a
 * failure here is logged and ignored instead of failing the booking.
 */
export async function registerDepositAddressWithAlchemyWebhook(depositAddress) {
  if (!isAlchemyWebhookAddressRegistryConfigured()) {
    return { registered: false, reason: 'ALCHEMY_WEBHOOK_NOT_CONFIGURED' };
  }

  const webhookResponse = await fetch(
    `${ALCHEMY_NOTIFY_API_BASE_URL}${ALCHEMY_UPDATE_WEBHOOK_ADDRESSES_PATH}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Alchemy-Token': process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN,
      },
      body: JSON.stringify({
        webhook_id: process.env.ALCHEMY_WEBHOOK_ID,
        addresses_to_add: [depositAddress],
        addresses_to_remove: [],
      }),
      // The booking request is waiting on this call, so it must not hang on a
      // slow or unreachable Alchemy API.
      signal: AbortSignal.timeout(ALCHEMY_WEBHOOK_REGISTRATION_TIMEOUT_MS),
    }
  );

  if (!webhookResponse.ok) {
    const responseBody = await webhookResponse.text().catch(() => '');
    throw new Error(
      `Alchemy webhook address registration failed with HTTP ${webhookResponse.status}: `
      + responseBody.slice(0, 300)
    );
  }

  return { registered: true, reason: null };
}

export async function registerDepositAddressWithAlchemyWebhookSafely(depositAddress) {
  try {
    return await registerDepositAddressWithAlchemyWebhook(depositAddress);
  } catch (registrationError) {
    logError('alchemy_webhook_address_registration_failed', {
      depositAddress,
      errorMessage: registrationError.message,
    });
    return { registered: false, reason: 'ALCHEMY_WEBHOOK_REGISTRATION_FAILED' };
  }
}
