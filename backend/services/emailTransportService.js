// Single place that decides how outbound email leaves this backend.
//
//   EMAIL_PROVIDER=apps_script -> a deployed Google Apps Script web app
//                                 (GmailApp + a Google Sheet delivery log)
//   EMAIL_PROVIDER=gmail       -> Gmail SMTP on port 465 with an app password
//   EMAIL_PROVIDER=smtp        -> any SMTP server via nodemailer (MailHog, Brevo, ...)
//
// Gmail is the default whenever GMAIL_USER is configured, so a deployment only
// has to add the two server-side variables. Apps Script is never inferred: it
// must be selected explicitly so a placeholder webhook URL cannot take over an
// existing SMTP deployment. Nothing in this module may be imported by a client
// component: GMAIL_APP_PASSWORD and APPS_SCRIPT_SHARED_SECRET must never reach a
// browser.
//
// The ticket renderer and these transports are Node-only because they read
// environment variables, open TCP sockets and use Buffer. The API routes that
// import them run on the Node.js runtime (Next's Pages API default), never Edge.

import nodemailer from 'nodemailer';

import { PLATFORM_BRAND_NAME, SUPPORT_EMAIL_ADDRESS } from './eventConfigService.js';

import {
  APPS_SCRIPT_EMAIL_PROVIDER,
  sendEmailThroughAppsScriptWebApp,
} from './appsScriptEmailDeliveryService.js';

export const EMAIL_PROVIDER_GMAIL = 'gmail';
export const EMAIL_PROVIDER_SMTP = 'smtp';
export const EMAIL_PROVIDER_APPS_SCRIPT = APPS_SCRIPT_EMAIL_PROVIDER;

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
// recognizable in an inbox instead of showing a bare address. Apps Script
// always sends from the account that deployed the script; MAIL_FROM is used
// there only as the reply-to fallback, while MAIL_FROM_NAME becomes the visible
// name.
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

// One call site decides whether a message goes through Nodemailer or the Apps
// Script web app. Ticket and receipt emails both use this, so switching
// providers never changes their content.
export async function sendOutboundEmailThroughConfiguredProvider(
  outboundEmailMessage,
  options = {}
) {
  const providerName = options.providerName ?? resolveEmailTransportProviderName();

  if (providerName === EMAIL_PROVIDER_APPS_SCRIPT) {
    return sendEmailThroughAppsScriptWebApp(
      outboundEmailMessage,
      options.deliveryMetadata ?? null,
      options
    );
  }

  const emailTransport =
    options.transport ?? (await createConfiguredEmailTransport({ providerName }));
  const sendInformation = await emailTransport.sendMail(outboundEmailMessage);

  return {
    provider: providerName,
    providerMessageId: sendInformation?.messageId ?? null,
    duplicate: false,
    remainingDailyQuota: null,
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

  if (providerName === EMAIL_PROVIDER_APPS_SCRIPT) {
    throw new Error(
      'EMAIL_PROVIDER_APPS_SCRIPT_USES_WEBHOOK: call sendOutboundEmailThroughConfiguredProvider instead'
    );
  }

  throw new Error(
    `EMAIL_PROVIDER_UNSUPPORTED:${providerName}. Use "${EMAIL_PROVIDER_APPS_SCRIPT}", "${EMAIL_PROVIDER_GMAIL}" or "${EMAIL_PROVIDER_SMTP}".`
  );
}
