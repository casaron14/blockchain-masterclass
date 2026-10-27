// Sends outbound email through a Google Apps Script web app instead of SMTP.
//
// The Apps Script deployment (apps-script/Code.gs) sends the message with
// MailApp, writes one row per delivery into a Google Sheet, and refuses a
// second send for the same delivery key. That makes the Sheet a human-readable
// mirror of every confirmed booking while Postgres stays the source of truth.
//
// This module must stay server-only: it reads APPS_SCRIPT_SHARED_SECRET, and
// that secret must never reach a browser or an error message.

import { SUPPORT_EMAIL_ADDRESS } from './eventConfigService.js';

export const APPS_SCRIPT_EMAIL_PROVIDER = 'apps_script';

const APPS_SCRIPT_DEPLOYMENT_URL_PATTERN =
  /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/(exec|dev)$/;
const DEFAULT_APPS_SCRIPT_REQUEST_TIMEOUT_MS = 15000;
const MAXIMUM_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;
const SAFE_REMOTE_ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

export class AppsScriptEmailDeliveryError extends Error {
  constructor(errorCode) {
    super(`APPS_SCRIPT_EMAIL_DELIVERY_FAILED:${errorCode}`);
    this.name = 'AppsScriptEmailDeliveryError';
    this.code = 'APPS_SCRIPT_EMAIL_DELIVERY_FAILED';
    this.errorCode = errorCode;
  }
}

function resolveAppsScriptRequestTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.APPS_SCRIPT_REQUEST_TIMEOUT_MS);

  if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0) {
    return DEFAULT_APPS_SCRIPT_REQUEST_TIMEOUT_MS;
  }

  return Math.floor(configuredTimeoutMs);
}

export function resolveAppsScriptEmailDeliveryConfiguration() {
  const webhookUrl = process.env.APPS_SCRIPT_TICKET_WEBHOOK_URL?.trim() || '';
  const sharedSecret = process.env.APPS_SCRIPT_SHARED_SECRET?.trim() || '';
  const isPlaceholderConfiguration =
    /replace|your-|example\.com/i.test(webhookUrl) ||
    /replace|your-/i.test(sharedSecret);

  if (!webhookUrl || !sharedSecret || isPlaceholderConfiguration) {
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_EMAIL_NOT_CONFIGURED');
  }

  if (!APPS_SCRIPT_DEPLOYMENT_URL_PATTERN.test(webhookUrl)) {
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_WEBHOOK_URL_INVALID');
  }

  return {
    webhookUrl,
    sharedSecret,
    requestTimeoutMs: resolveAppsScriptRequestTimeoutMs(),
  };
}

export function isAppsScriptEmailDeliveryConfigured() {
  try {
    resolveAppsScriptEmailDeliveryConfiguration();
    return true;
  } catch {
    return false;
  }
}

function convertEmailAttachmentToAppsScriptPayload(attachment) {
  const attachmentContent = attachment?.content;

  if (!Buffer.isBuffer(attachmentContent)) {
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_ATTACHMENT_NOT_A_BUFFER');
  }

  if (attachmentContent.byteLength > MAXIMUM_ATTACHMENT_SIZE_BYTES) {
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_ATTACHMENT_TOO_LARGE');
  }

  return {
    fileName: String(attachment.filename || 'attachment'),
    mimeType: String(attachment.contentType || 'application/octet-stream'),
    base64Content: attachmentContent.toString('base64'),
  };
}

function readEmailRecipientAddress(outboundEmailMessage) {
  const recipientEmailAddress = outboundEmailMessage?.to;

  if (typeof recipientEmailAddress !== 'string' || !recipientEmailAddress.trim()) {
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_RECIPIENT_MISSING');
  }

  return recipientEmailAddress.trim();
}

export function buildAppsScriptEmailDeliveryRequest(
  outboundEmailMessage,
  deliveryMetadata,
  sharedSecret
) {
  if (!deliveryMetadata?.deliveryKey || !deliveryMetadata?.emailKind) {
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_DELIVERY_METADATA_MISSING');
  }

  return {
    sharedSecret,
    emailRequest: {
      deliveryKey: deliveryMetadata.deliveryKey,
      emailKind: deliveryMetadata.emailKind,
      recipientEmailAddress: readEmailRecipientAddress(outboundEmailMessage),
      emailSubject: String(outboundEmailMessage.subject ?? ''),
      emailTextBody: String(outboundEmailMessage.text ?? ''),
      emailHtmlBody: String(outboundEmailMessage.html ?? ''),
      senderDisplayName: String(outboundEmailMessage.from?.name ?? ''),
      replyToEmailAddress: String(
        outboundEmailMessage.replyTo?.address ?? SUPPORT_EMAIL_ADDRESS
      ),
      attachments: (outboundEmailMessage.attachments ?? []).map(
        convertEmailAttachmentToAppsScriptPayload
      ),
      booking: deliveryMetadata.booking ?? null,
      event: deliveryMetadata.event ?? null,
      ticket: deliveryMetadata.ticket ?? null,
    },
  };
}

function normalizeRemoteErrorCode(remoteErrorCode) {
  const normalizedErrorCode = String(remoteErrorCode ?? '').toLowerCase();

  return SAFE_REMOTE_ERROR_CODE_PATTERN.test(normalizedErrorCode)
    ? normalizedErrorCode
    : 'APPS_SCRIPT_REMOTE_ERROR';
}

export function parseAppsScriptEmailDeliveryResponse(responseStatus, responseText) {
  if (responseStatus < 200 || responseStatus >= 300) {
    throw new AppsScriptEmailDeliveryError(`APPS_SCRIPT_HTTP_${responseStatus}`);
  }

  let responseBody;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    // A login page or an Apps Script HTML error page lands here. It is
    // retryable because a deployment can be temporarily unavailable.
    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_RESPONSE_NOT_JSON');
  }

  if (responseBody?.ok !== true) {
    throw new AppsScriptEmailDeliveryError(normalizeRemoteErrorCode(responseBody?.error));
  }

  return {
    provider: APPS_SCRIPT_EMAIL_PROVIDER,
    providerMessageId: responseBody.deliveryId ? String(responseBody.deliveryId) : null,
    duplicate: responseBody.duplicate === true,
    remainingDailyQuota: Number.isFinite(responseBody.remainingDailyQuota)
      ? responseBody.remainingDailyQuota
      : null,
  };
}

export async function sendEmailThroughAppsScriptWebApp(
  outboundEmailMessage,
  deliveryMetadata,
  options = {}
) {
  const deliveryConfiguration =
    options.deliveryConfiguration ?? resolveAppsScriptEmailDeliveryConfiguration();
  const requestBody = buildAppsScriptEmailDeliveryRequest(
    outboundEmailMessage,
    deliveryMetadata,
    deliveryConfiguration.sharedSecret
  );
  const fetchImplementation = options.fetchImplementation ?? fetch;

  let response;
  try {
    response = await fetchImplementation(deliveryConfiguration.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      redirect: 'follow',
      signal: AbortSignal.timeout(deliveryConfiguration.requestTimeoutMs),
    });
  } catch (requestError) {
    if (
      requestError?.name === 'TimeoutError' ||
      requestError?.name === 'AbortError'
    ) {
      throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_REQUEST_TIMED_OUT');
    }

    throw new AppsScriptEmailDeliveryError('APPS_SCRIPT_REQUEST_FAILED');
  }

  return parseAppsScriptEmailDeliveryResponse(response.status, await response.text());
}
