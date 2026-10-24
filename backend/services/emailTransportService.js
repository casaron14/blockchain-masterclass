// Single place that decides how outbound email leaves this backend.
//
//   EMAIL_PROVIDER=smtp -> any SMTP server via nodemailer (the local MailHog
//                          default used by the test suite)
//
// The Gmail API transport was removed because this deployment does not send
// email and the `googleapis` package added more than 200 MB to every install.
// SMTP stays available for self-hosted deployments that enable email delivery.

import nodemailer from 'nodemailer';

export const EMAIL_PROVIDER_SMTP = 'smtp';

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

  if (providerName === EMAIL_PROVIDER_SMTP) {
    return createSmtpEmailTransport();
  }

  throw new Error(
    `EMAIL_PROVIDER_UNSUPPORTED:${providerName}. Use "${EMAIL_PROVIDER_SMTP}".`
  );
}
