// Shared HTTPS client for the deployed Google Apps Script web app.
//
// The same deployment receives two kinds of request:
//   - an email delivery request (`sendEmailThroughAppsScriptWebApp`)
//   - a booking mirror sync request (`syncAllBookingsToGoogleSheet`)
//
// Keeping the URL, secret, timeout and response contract in one module means a
// new request type cannot accidentally skip the shared-secret check or leak the
// secret in an error message. This module is server-only: it reads
// APPS_SCRIPT_SHARED_SECRET, which must never reach a browser.

export const APPS_SCRIPT_WEBHOOK_ERROR_CODE = 'APPS_SCRIPT_WEBHOOK_FAILED';

export const APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED_ERROR_CODE =
  'APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED';
export const APPS_SCRIPT_WEBHOOK_URL_INVALID_ERROR_CODE =
  'APPS_SCRIPT_WEBHOOK_URL_INVALID';
export const APPS_SCRIPT_DEV_URL_NOT_ALLOWED_ERROR_CODE =
  'APPS_SCRIPT_DEV_URL_NOT_ALLOWED';

const APPS_SCRIPT_EXEC_DEPLOYMENT_URL_PATTERN =
  /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const APPS_SCRIPT_DEV_DEPLOYMENT_URL_PATTERN =
  /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/dev$/;
const DEFAULT_APPS_SCRIPT_REQUEST_TIMEOUT_MS = 15000;
const MAXIMUM_REMOTE_ERROR_MESSAGE_LENGTH = 300;
const EMAIL_ADDRESS_IN_ERROR_MESSAGE_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SAFE_REMOTE_ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;
const PLACEHOLDER_WEBHOOK_URL_PATTERN = /replace|your-|example\.com/i;
const PLACEHOLDER_SHARED_SECRET_PATTERN = /replace|your-/i;

function normalizeRemoteErrorMessage(remoteErrorMessage) {
  const normalizedRemoteErrorMessage = String(remoteErrorMessage ?? '')
    .replace(EMAIL_ADDRESS_IN_ERROR_MESSAGE_PATTERN, '[redacted-email]')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizedRemoteErrorMessage
    ? normalizedRemoteErrorMessage.slice(0, MAXIMUM_REMOTE_ERROR_MESSAGE_LENGTH)
    : null;
}

export class AppsScriptWebhookError extends Error {
  constructor(errorCode, options = {}) {
    super(`APPS_SCRIPT_WEBHOOK_FAILED:${errorCode}`);
    this.name = 'AppsScriptWebhookError';
    this.code = APPS_SCRIPT_WEBHOOK_ERROR_CODE;
    this.errorCode = errorCode;
    this.remoteErrorMessage = normalizeRemoteErrorMessage(
      options.remoteErrorMessage
    );
  }
}

function resolveAppsScriptRequestTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.APPS_SCRIPT_REQUEST_TIMEOUT_MS);

  if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0) {
    return DEFAULT_APPS_SCRIPT_REQUEST_TIMEOUT_MS;
  }

  return Math.floor(configuredTimeoutMs);
}

export function resolveAppsScriptWebhookConfiguration() {
  const webhookUrl = process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL?.trim() || '';
  const sharedSecret = process.env.APPS_SCRIPT_SHARED_SECRET?.trim() || '';
  const isPlaceholderConfiguration =
    PLACEHOLDER_WEBHOOK_URL_PATTERN.test(webhookUrl) ||
    PLACEHOLDER_SHARED_SECRET_PATTERN.test(sharedSecret);

  if (!webhookUrl || !sharedSecret || isPlaceholderConfiguration) {
    throw new AppsScriptWebhookError(APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED_ERROR_CODE);
  }

  if (APPS_SCRIPT_DEV_DEPLOYMENT_URL_PATTERN.test(webhookUrl)) {
    throw new AppsScriptWebhookError(
      APPS_SCRIPT_DEV_URL_NOT_ALLOWED_ERROR_CODE
    );
  }

  if (!APPS_SCRIPT_EXEC_DEPLOYMENT_URL_PATTERN.test(webhookUrl)) {
    throw new AppsScriptWebhookError(APPS_SCRIPT_WEBHOOK_URL_INVALID_ERROR_CODE);
  }

  return {
    webhookUrl,
    sharedSecret,
    requestTimeoutMs: resolveAppsScriptRequestTimeoutMs(),
  };
}

export function isAppsScriptWebhookConfigured() {
  try {
    resolveAppsScriptWebhookConfiguration();
    return true;
  } catch {
    return false;
  }
}

function normalizeRemoteErrorCode(remoteErrorCode) {
  const normalizedErrorCode = String(remoteErrorCode ?? '').toLowerCase();

  return SAFE_REMOTE_ERROR_CODE_PATTERN.test(normalizedErrorCode)
    ? normalizedErrorCode
    : 'APPS_SCRIPT_REMOTE_ERROR';
}

export function parseAppsScriptWebhookResponse(responseStatus, responseText) {
  if (responseStatus < 200 || responseStatus >= 300) {
    throw new AppsScriptWebhookError(`APPS_SCRIPT_HTTP_${responseStatus}`);
  }

  let responseBody;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    // A login page or an Apps Script HTML error page lands here. It is
    // retryable because a deployment can be temporarily unavailable.
    throw new AppsScriptWebhookError('APPS_SCRIPT_RESPONSE_NOT_JSON');
  }

  if (responseBody?.ok !== true) {
    throw new AppsScriptWebhookError(
      normalizeRemoteErrorCode(responseBody?.error),
      {
        remoteErrorMessage: responseBody?.mailErrorMessage,
      }
    );
  }

  return responseBody;
}

// Adds the configured shared secret to the body rather than making every
// caller remember it. The secret is never logged and never placed in a URL.
export async function postJsonRequestToAppsScriptWebApp(
  requestBody,
  options = {}
) {
  const deliveryConfiguration =
    options.configuration ?? resolveAppsScriptWebhookConfiguration();
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const requestBodyWithSharedSecret = {
    ...requestBody,
    sharedSecret: deliveryConfiguration.sharedSecret,
  };

  let response;
  try {
    response = await fetchImplementation(deliveryConfiguration.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBodyWithSharedSecret),
      redirect: 'follow',
      signal: AbortSignal.timeout(deliveryConfiguration.requestTimeoutMs),
    });
  } catch (requestError) {
    if (
      requestError?.name === 'TimeoutError' ||
      requestError?.name === 'AbortError'
    ) {
      throw new AppsScriptWebhookError('APPS_SCRIPT_REQUEST_TIMED_OUT');
    }

    throw new AppsScriptWebhookError('APPS_SCRIPT_REQUEST_FAILED');
  }

  return parseAppsScriptWebhookResponse(response.status, await response.text());
}
