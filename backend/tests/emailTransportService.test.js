import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_PROVIDER_GMAIL,
  EMAIL_PROVIDER_SMTP,
  buildGmailSmtpTransportConfiguration,
  buildSmtpTransportConfiguration,
  createConfiguredEmailTransport,
  resolveEmailTransportProviderName,
} from '../services/emailTransportService.js';

function withEnvironmentVariables(environmentValues, testBody) {
  const previousValues = {};
  for (const variableName of Object.keys(environmentValues)) {
    previousValues[variableName] = process.env[variableName];
    if (environmentValues[variableName] === undefined) {
      delete process.env[variableName];
    } else {
      process.env[variableName] = environmentValues[variableName];
    }
  }

  try {
    return testBody();
  } finally {
    for (const variableName of Object.keys(environmentValues)) {
      if (previousValues[variableName] === undefined) {
        delete process.env[variableName];
      } else {
        process.env[variableName] = previousValues[variableName];
      }
    }
  }
}

test('resolveEmailTransportProviderName defaults to smtp and normalises the configured provider', () => {
  withEnvironmentVariables(
    { EMAIL_PROVIDER: undefined, GMAIL_USER: undefined },
    () => {
      assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_SMTP);

      process.env.EMAIL_PROVIDER = ' SMTP ';
      assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_SMTP);
    }
  );
});

test('resolveEmailTransportProviderName selects Gmail when GMAIL_USER is configured', () => {
  withEnvironmentVariables(
    {
      EMAIL_PROVIDER: undefined,
      GMAIL_USER: 'tickets@example.com',
      GMAIL_APP_PASSWORD: 'app-password',
    },
    () => {
      assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_GMAIL);
    }
  );
});

test('buildGmailSmtpTransportConfiguration uses Gmail port 465 with TLS', () => {
  withEnvironmentVariables(
    {
      GMAIL_USER: 'tickets@example.com',
      GMAIL_APP_PASSWORD: 'app-password',
    },
    () => {
      const gmailConfiguration = buildGmailSmtpTransportConfiguration();

      assert.deepEqual(gmailConfiguration, {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: 'tickets@example.com',
          pass: 'app-password',
        },
      });
    }
  );
});

test('buildGmailSmtpTransportConfiguration refuses to run without server credentials', () => {
  withEnvironmentVariables(
    { GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined },
    () => {
      assert.throws(
        () => buildGmailSmtpTransportConfiguration(),
        /GMAIL_SMTP_CREDENTIALS_MISSING/
      );
    }
  );
});

test('createConfiguredEmailTransport creates a Gmail transport with a sendMail method', async () => {
  await withEnvironmentVariables(
    {
      GMAIL_USER: 'tickets@example.com',
      GMAIL_APP_PASSWORD: 'app-password',
    },
    async () => {
      const emailTransport = await createConfiguredEmailTransport({
        providerName: EMAIL_PROVIDER_GMAIL,
      });

      assert.equal(typeof emailTransport.sendMail, 'function');
    }
  );
});

test('createConfiguredEmailTransport creates an SMTP transport with a sendMail method', async () => {
  const emailTransport = await createConfiguredEmailTransport({ providerName: 'smtp' });

  assert.equal(typeof emailTransport.sendMail, 'function');
});

test('createConfiguredEmailTransport rejects an unknown provider instead of attempting a send', async () => {
  await assert.rejects(
    () => createConfiguredEmailTransport({ providerName: 'gmail_api' }),
    /EMAIL_PROVIDER_UNSUPPORTED:gmail_api\. Use "gmail" or "smtp"/
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
