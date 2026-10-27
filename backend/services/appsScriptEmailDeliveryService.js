// Sends outbound email through a Google Apps Script web app instead of SMTP.
//
// The Apps Script deployment (apps-script/Code.gs) sends the message with
// GmailApp, writes one row per delivery into a Google Sheet, and refuses a
// second send for the same delivery key. That makes the Sheet a human-readable
// mirror of every confirmed booking while Postgres stays the source of truth.
//
// This module must stay server-only: it reads APPS_SCRIPT_SHARED_SECRET, and
// that secret must never reach a browser or an error message.

import { SUPPORT_EMAIL_ADDRESS } from './eventConfigService.js';

import {
  AppsScriptWebhookError,
  isAppsScriptWebhookConfigured,
  parseAppsScriptWebhookResponse,
  postJsonRequestToAppsScriptWebApp,
  resolveAppsScriptWebhookConfiguration,
} from './appsScriptWebhookClientService.js';

export const APPS_SCRIPT_EMAIL_PROVIDER = 'apps_script';

const MAXIMUM_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;

// Kept as named exports because the email transport and its tests talk about an
// email delivery, even though the underlying webhook contract is shared with
// the booking mirror sync.
export const AppsScriptEmailDeliveryError = AppsScriptWebhookError;
export const resolveAppsScriptEmailDeliveryConfiguration =
  resolveAppsScriptWebhookConfiguration;
export const isAppsScriptEmailDeliveryConfigured = isAppsScriptWebhookConfigured;

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

function buildAppsScriptEmailDeliveryOutcome(responseBody) {
  return {
    provider: APPS_SCRIPT_EMAIL_PROVIDER,
    providerMessageId: responseBody.deliveryId
      ? String(responseBody.deliveryId)
      : null,
    duplicate: responseBody.duplicate === true,
    remainingDailyQuota: Number.isFinite(responseBody.remainingDailyQuota)
      ? responseBody.remainingDailyQuota
      : null,
  };
}

export function parseAppsScriptEmailDeliveryResponse(
  responseStatus,
  responseText
) {
  return buildAppsScriptEmailDeliveryOutcome(
    parseAppsScriptWebhookResponse(responseStatus, responseText)
  );
}

export async function sendEmailThroughAppsScriptWebApp(
  outboundEmailMessage,
  deliveryMetadata,
  options = {}
) {
  const deliveryConfiguration =
    options.deliveryConfiguration ?? resolveAppsScriptWebhookConfiguration();
  const requestBody = buildAppsScriptEmailDeliveryRequest(
    outboundEmailMessage,
    deliveryMetadata,
    deliveryConfiguration.sharedSecret
  );
  const responseBody = await postJsonRequestToAppsScriptWebApp(requestBody, {
    ...options,
    configuration: deliveryConfiguration,
  });

  return buildAppsScriptEmailDeliveryOutcome(responseBody);
}
