import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_PROVIDER_SMTP,
  buildSmtpTransportConfiguration,
  createConfiguredEmailTransport,
  resolveEmailTransportProviderName,
} from '../services/emailTransportService.js';

test('resolveEmailTransportProviderName defaults to smtp and normalises the configured provider', () => {
  const previousProvider = process.env.EMAIL_PROVIDER;

  try {
    delete process.env.EMAIL_PROVIDER;
    assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_SMTP);

    process.env.EMAIL_PROVIDER = ' SMTP ';
    assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_SMTP);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.EMAIL_PROVIDER;
    } else {
      process.env.EMAIL_PROVIDER = previousProvider;
    }
  }
});

test('createConfiguredEmailTransport creates an SMTP transport with a sendMail method', async () => {
  const emailTransport = await createConfiguredEmailTransport({ providerName: 'smtp' });

  assert.equal(typeof emailTransport.sendMail, 'function');
});

test('createConfiguredEmailTransport rejects the removed gmail_api provider instead of attempting a send', async () => {
  await assert.rejects(
    () => createConfiguredEmailTransport({ providerName: 'gmail_api' }),
    /EMAIL_PROVIDER_UNSUPPORTED:gmail_api\. Use "smtp"/
  );
});

test('buildSmtpTransportConfiguration marks the connection secure only when MAIL_SECURE is enabled', () => {
  const previousSecure = process.env.MAIL_SECURE;

  try {
    process.env.MAIL_SECURE = 'true';
    assert.equal(buildSmtpTransportConfiguration().secure, true);

    delete process.env.MAIL_SECURE;
    assert.equal(buildSmtpTransportConfiguration().secure, false);
  } finally {
    if (previousSecure === undefined) {
      delete process.env.MAIL_SECURE;
    } else {
      process.env.MAIL_SECURE = previousSecure;
    }
  }
});
