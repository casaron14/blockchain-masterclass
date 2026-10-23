// Single place that decides how outbound email leaves this backend.
//
//   EMAIL_PROVIDER=gmail_api -> Gmail API (Google's free tier, ~500 sends per
//                               mailbox per rolling day; no local cap enforced)
//   EMAIL_PROVIDER=smtp      -> any SMTP server via nodemailer (the local
//                               MailHog default used by the test suite)

import nodemailer from 'nodemailer';

import { createGmailApiTransport } from './gmailApiEmailService.js';

export const EMAIL_PROVIDER_SMTP = 'smtp';
export const EMAIL_PROVIDER_GMAIL_API = 'gmail_api';

export function resolveEmailTransportProviderName() {
  return (process.env.EMAIL_PROVIDER || EMAIL_PROVIDER_SMTP).trim().toLowerCase();
}

export function buildSmtpTransportConfiguration() {
  return {
    host: process.env.MAIL_HOST || 'localhost',
    port: Number(process.env.MAIL_PORT || 1025),
    secure: process.env.MAIL_SECURE === 'true',
    auth: process.env.MAIL_USER
      ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
      : undefined,
  };
}

export function createSmtpEmailTransport() {
  return nodemailer.createTransport(buildSmtpTransportConfiguration());
}

export async function createConfiguredEmailTransport(options = {}) {
  const providerName = options.providerName ?? resolveEmailTransportProviderName();

  if (providerName === EMAIL_PROVIDER_GMAIL_API) {
    return createGmailApiTransport(options);
  }

  if (providerName === EMAIL_PROVIDER_SMTP) {
    return createSmtpEmailTransport();
  }

  throw new Error(
    `EMAIL_PROVIDER_UNSUPPORTED:${providerName}. Use "${EMAIL_PROVIDER_SMTP}" or "${EMAIL_PROVIDER_GMAIL_API}".`
  );
}