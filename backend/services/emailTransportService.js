// Single place that decides how outbound email leaves this backend.
//
//   EMAIL_PROVIDER=gmail -> Gmail SMTP on port 465 with a Google app password
//   EMAIL_PROVIDER=smtp  -> any SMTP server via nodemailer (MailHog, Brevo, ...)
//
// Gmail is the default whenever GMAIL_USER is configured, so a deployment only
// has to add the two server-side variables. Nothing in this module may be
// imported by a client component: GMAIL_APP_PASSWORD must never reach a browser.
//
// The ticket renderer and these transports are Node-only because they read
// environment variables, open TCP sockets and use Buffer. The API routes that
// import them run on the Node.js runtime (Next's Pages API default), never Edge.

import nodemailer from 'nodemailer';

import { PLATFORM_BRAND_NAME, SUPPORT_EMAIL_ADDRESS } from './eventConfigService.js';

export const EMAIL_PROVIDER_GMAIL = 'gmail';
export const EMAIL_PROVIDER_SMTP = 'smtp';

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 465;
const GMAIL_SMTP_SECURE = true;

function readGmailUserAddress() {
  return process.env.GMAIL_USER?.trim() || '';
}

function readGmailAppPassword() {
  return process.env.GMAIL_APP_PASSWORD?.trim() || '';
}

export function resolveEmailTransportProviderName() {
  const configuredProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();

  if (configuredProvider) {
    return configuredProvider;
  }

  return readGmailUserAddress() ? EMAIL_PROVIDER_GMAIL : EMAIL_PROVIDER_SMTP;
}

export function buildGmailSmtpTransportConfiguration() {
  const gmailUserAddress = readGmailUserAddress();
  const gmailAppPassword = readGmailAppPassword();

  if (!gmailUserAddress || !gmailAppPassword) {
    throw new Error(
      'GMAIL_SMTP_CREDENTIALS_MISSING: set GMAIL_USER and GMAIL_APP_PASSWORD on the server'
    );
  }

  return {
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    secure: GMAIL_SMTP_SECURE,
    auth: {
      user: gmailUserAddress,
      pass: gmailAppPassword,
    },
  };
}

export function createGmailSmtpEmailTransport() {
  return nodemailer.createTransport(buildGmailSmtpTransportConfiguration());
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

// Nodemailer accepts a display-name object, which is what makes the sender
// recognizable in an inbox instead of showing a bare address.
export function resolveOutboundEmailSenderIdentity() {
  const configuredProvider = resolveEmailTransportProviderName();
  const configuredSenderAddress = process.env.MAIL_FROM?.trim();

  const senderAddress =
    configuredProvider === EMAIL_PROVIDER_GMAIL
      ? readGmailUserAddress()
      : configuredSenderAddress || readGmailUserAddress() || SUPPORT_EMAIL_ADDRESS;

  if (!senderAddress) {
    throw new Error(
      'OUTBOUND_EMAIL_SENDER_MISSING: set GMAIL_USER or MAIL_FROM on the server'
    );
  }

  return {
    name: process.env.MAIL_FROM_NAME?.trim() || `${PLATFORM_BRAND_NAME} Events`,
    address: senderAddress,
  };
}

export async function createConfiguredEmailTransport(options = {}) {
  const providerName = options.providerName ?? resolveEmailTransportProviderName();

  if (providerName === EMAIL_PROVIDER_GMAIL) {
    return createGmailSmtpEmailTransport();
  }

  if (providerName === EMAIL_PROVIDER_SMTP) {
    return createSmtpEmailTransport();
  }

  throw new Error(
    `EMAIL_PROVIDER_UNSUPPORTED:${providerName}. Use "${EMAIL_PROVIDER_GMAIL}" or "${EMAIL_PROVIDER_SMTP}".`
  );
}
