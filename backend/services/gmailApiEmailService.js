// A transport with the same `sendMail(...)` surface as a nodemailer transport,
// implemented on top of the Gmail API.
//
// Existing services (ticket delivery, payment receipts) keep calling
// `sendMail` and keep passing nodemailer-style attachments, so switching from a
// local SMTP server to Gmail is a configuration change rather than a rewrite of
// every email call site.

import {
  createGmailApiAuthenticationClient,
  resolveGmailSenderAccountEmail,
  resolveGmailSenderDisplayAddress,
} from './gmailApiAuthenticationService.js';

import { buildGmailRawMessageFromEmailDraft } from './gmailApiMessageService.js';
import { loadGmailApiModule } from './gmailApiModuleLoader.js';

export function describeGmailSendFailure(gmailSendError) {
  const apiErrorReason = gmailSendError?.errors?.[0]?.reason;
  const apiErrorMessage = gmailSendError?.errors?.[0]?.message;
  const responseMessage = gmailSendError?.message;

  if (apiErrorReason === 'quotaExceeded') {
    return `GMAIL_SEND_QUOTA_EXCEEDED:${responseMessage ?? apiErrorMessage ?? 'daily sending limit reached for this sender'}`;
  }

  if (apiErrorReason === 'dailyLimitExceeded') {
    return `GMAIL_DAILY_SENDING_LIMIT_EXCEEDED:${apiErrorMessage ?? responseMessage ?? 'the mailbox cannot send any more messages today'}`;
  }

  return `GMAIL_SEND_FAILED:${responseMessage ?? apiErrorMessage ?? 'unknown Gmail API error'}`;
}

async function sendGmailMessageThroughApi(gmailClient, senderAccountEmail, emailDraft) {
  const rawEncodedMessage = await buildGmailRawMessageFromEmailDraft(emailDraft);

  const gmailSendResponse = await gmailClient.users.messages.send({
    userId: senderAccountEmail,
    requestBody: { raw: rawEncodedMessage },
  });

  return gmailSendResponse?.data ?? {};
}

function buildGmailTransportSendResult(gmailSendResponse, emailDraft) {
  return {
    messageId: gmailSendResponse.id ?? null,
    threadId: gmailSendResponse.threadId ?? null,
    envelope: {
      from: emailDraft.from ?? null,
      to: emailDraft.to ?? null,
    },
    accepted: emailDraft.to ?? [],
    rejected: [],
    response: gmailSendResponse.id ?? 'Gmail API accepted the message',
  };
}

export async function createGmailApiTransport(options = {}) {
  const googleApisLibrary = options.googleApis ?? (await loadGmailApiModule());
  const authenticationClient =
    options.authenticationClient ?? (await createGmailApiAuthenticationClient(options));
  const senderAccountEmail =
    options.senderAccountEmail ?? resolveGmailSenderAccountEmail();
  const senderDisplayAddress =
    options.senderDisplayAddress ?? resolveGmailSenderDisplayAddress();

  const gmailClient = googleApisLibrary.gmail({ version: 'v1', auth: authenticationClient });

  return {
    async sendMail(emailDraft) {
      const normalizedEmailDraft = {
        ...emailDraft,
        from: emailDraft.from ?? senderDisplayAddress,
      };

      try {
        const gmailSendResponse = await sendGmailMessageThroughApi(
          gmailClient,
          senderAccountEmail,
          normalizedEmailDraft
        );

        return buildGmailTransportSendResult(gmailSendResponse, normalizedEmailDraft);
      } catch (gmailSendError) {
        throw new Error(describeGmailSendFailure(gmailSendError));
      }
    },
  };
}