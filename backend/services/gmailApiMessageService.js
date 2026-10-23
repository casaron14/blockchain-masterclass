// Turns the email drafts the services build (the same shape nodemailer accepts)
// into the single base64url-encoded RFC 2822 blob the Gmail API expects in
// `users.messages.send({ requestBody: { raw } })`.
//
// Keeping the conversion in its own module means the MIME details are tested
// without a network call, and the Gmail transport stays a thin adapter.

import fs from 'fs/promises';

const CRLF = '\r\n';
const DEFAULT_MIME_BOUNDARY_PREFIX = 'blockchain_masterclass_boundary';
const UTF8_SUBJECT_PATTERN = /[^\x20-\x7E]/;
const GMAIL_MAXIMUM_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function encodeHeaderValue(value) {
  if (typeof value !== 'string') {
    return String(value ?? '');
  }

  if (UTF8_SUBJECT_PATTERN.test(value)) {
    return encodeMimeWord(value);
  }

  return value;
}

function normalizeRecipientAddressList(recipientValue) {
  const recipientList = Array.isArray(recipientValue)
    ? recipientValue
    : [recipientValue];

  return recipientList
    .filter((recipientAddress) => typeof recipientAddress === 'string' && recipientAddress.trim() !== '')
    .map((recipientAddress) => recipientAddress.trim())
    .join(', ');
}

function buildMimeBoundary(seedSuffix) {
  return `${DEFAULT_MIME_BOUNDARY_PREFIX}_${seedSuffix}`;
}

async function readEmailAttachmentContent(attachmentDefinition) {
  if (attachmentDefinition.content !== undefined && attachmentDefinition.content !== null) {
    return Buffer.isBuffer(attachmentDefinition.content)
      ? attachmentDefinition.content
      : Buffer.from(attachmentDefinition.content);
  }

  if (!attachmentDefinition.path) {
    throw new Error(
      `EMAIL_ATTACHMENT_CONTENT_MISSING:${attachmentDefinition.filename ?? 'unnamed attachment'}`
    );
  }

  return fs.readFile(attachmentDefinition.path);
}

async function buildEncodedAttachmentPart(attachmentDefinition, boundary) {
  const attachmentContent = await readEmailAttachmentContent(attachmentDefinition);
  const attachmentMimeType =
    attachmentDefinition.contentType || 'application/octet-stream';

  const attachmentPartHeaders = [
    `--${boundary}`,
    `Content-Type: ${attachmentMimeType}; name="${attachmentDefinition.filename ?? 'attachment'}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachmentDefinition.filename ?? 'attachment'}"`,
    '',
  ].join(CRLF);

  return Buffer.concat([
    Buffer.from(attachmentPartHeaders, 'utf8'),
    encodeBase64Body(attachmentContent),
    Buffer.from(CRLF, 'utf8'),
  ]);
}

function encodeBase64Body(bodyBuffer) {
  const base64Body = bodyBuffer.toString('base64');
  const wrappedLines = base64Body.match(/.{1,76}/g) ?? [''];
  return Buffer.from(wrappedLines.join(CRLF) + CRLF, 'utf8');
}

async function buildBodyPartsForEmailDraft(emailDraft, boundary) {
  const attachmentDefinitions = emailDraft.attachments ?? [];
  const bodyParts = [];

  const htmlBody = emailDraft.html ?? `<p>${emailDraft.text ?? ''}</p>`;
  bodyParts.push(
    Buffer.from(
      [
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
      ].join(CRLF),
      'utf8'
    ),
    encodeBase64Body(Buffer.from(htmlBody, 'utf8'))
  );

  for (const attachmentDefinition of attachmentDefinitions) {
    bodyParts.push(await buildEncodedAttachmentPart(attachmentDefinition, boundary));
  }

  bodyParts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

  return Buffer.concat(bodyParts);
}

function buildSinglePartBody(emailDraft) {
  const htmlBody = emailDraft.html ?? `<p>${emailDraft.text ?? ''}</p>`;
  return Buffer.from(htmlBody, 'utf8');
}

export async function buildGmailMimeMessageFromEmailDraft(emailDraft) {
  const recipientAddresses = normalizeRecipientAddressList(emailDraft.to);

  if (!recipientAddresses) {
    throw new Error('EMAIL_RECIPIENT_MISSING: the email draft has no `to` address.');
  }

  const messageBoundary = buildMimeBoundary(
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );

  const attachmentDefinitions = emailDraft.attachments ?? [];
  const hasAttachments = attachmentDefinitions.length > 0;

  const bodyBuffer = hasAttachments
    ? await buildBodyPartsForEmailDraft(emailDraft, messageBoundary)
    : buildSinglePartBody(emailDraft);

  const contentTypeHeader = hasAttachments
    ? `multipart/mixed; boundary="${messageBoundary}"`
    : 'text/html; charset="UTF-8"';

  const messageHeaders = [
    `From: ${emailDraft.from ?? ''}`,
    `To: ${recipientAddresses}`,
    `Subject: ${encodeHeaderValue(emailDraft.subject ?? '')}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentTypeHeader}`,
    '',
    '',
  ].join(CRLF);

  return Buffer.concat([Buffer.from(messageHeaders, 'utf8'), bodyBuffer]);
}

export function encodeGmailRawMessageFromMimeMessage(mimeMessageBuffer) {
  return mimeMessageBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function buildGmailRawMessageFromEmailDraft(emailDraft) {
  const mimeMessageBuffer = await buildGmailMimeMessageFromEmailDraft(emailDraft);

  if (mimeMessageBuffer.length > GMAIL_MAXIMUM_RAW_MESSAGE_BYTES) {
    throw new Error(
      `EMAIL_MESSAGE_TOO_LARGE_FOR_GMAIL:${mimeMessageBuffer.length} bytes exceeds the ${GMAIL_MAXIMUM_RAW_MESSAGE_BYTES} byte Gmail limit`
    );
  }

  return encodeGmailRawMessageFromMimeMessage(mimeMessageBuffer);
}