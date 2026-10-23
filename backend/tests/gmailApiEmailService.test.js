import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGmailRawMessageFromEmailDraft,
  encodeGmailRawMessageFromMimeMessage,
} from '../services/gmailApiMessageService.js';

import {
  createGmailApiTransport,
  describeGmailSendFailure,
} from '../services/gmailApiEmailService.js';

import {
  GMAIL_AUTHENTICATION_STRATEGY_OAUTH_REFRESH_TOKEN,
  GMAIL_AUTHENTICATION_STRATEGY_SERVICE_ACCOUNT,
  GMAIL_SEND_SCOPE,
  detectGmailAuthenticationStrategy,
  createGmailApiAuthenticationClient,
  resolveGmailSenderAccountEmail,
} from '../services/gmailApiAuthenticationService.js';

import {
  EMAIL_PROVIDER_GMAIL_API,
  buildSmtpTransportConfiguration,
  resolveEmailTransportProviderName,
} from '../services/emailTransportService.js';

function decodeGmailRawMessage(rawEncodedMessage) {
  const standardBase64 = rawEncodedMessage.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standardBase64, 'base64').toString('utf8');
}

function buildGmailApiStubClient(sendBehavior) {
  const sentRequests = [];

  return {
    sentRequests,
    users: {
      messages: {
        async send(requestParameters) {
          sentRequests.push(requestParameters);
          if (sendBehavior?.throwOnSend) {
            throw sendBehavior.throwOnSend;
          }
          return { data: { id: 'gmail-message-1', threadId: 'gmail-thread-1' } };
        },
      },
    },
  };
}

async function buildTransportAroundStubClient(stubClient, overrides = {}) {
  const googleApisStub = {
    gmail: () => stubClient,
  };

  return createGmailApiTransport({
    googleApis: googleApisStub,
    authenticationClient: { stub: true },
    senderAccountEmail: 'sender@masterclass.test',
    senderDisplayAddress: 'Blockchain Masterclass <no-reply@masterclass.test>',
    ...overrides,
  });
}

test('buildGmailRawMessageFromEmailDraft produces a MIME-wrapped ticket email with its PDF attachment', async () => {
  const rawEncodedMessage = await buildGmailRawMessageFromEmailDraft({
    from: 'Blockchain Masterclass <no-reply@masterclass.test>',
    to: 'attendee@example.com',
    subject: 'Your ticket (BK-1001)',
    html: '<p>Thanks for booking</p>',
    attachments: [
      {
        filename: 'ticket-BK-1001.pdf',
        content: Buffer.from('%PDF-1.4 ticket bytes'),
        contentType: 'application/pdf',
      },
    ],
  });

  const decodedMessage = decodeGmailRawMessage(rawEncodedMessage);

  assert.match(decodedMessage, /^From: Blockchain Masterclass <no-reply@masterclass\.test>/m);
  assert.match(decodedMessage, /^To: attendee@example\.com$/m);
  assert.match(decodedMessage, /^Subject: Your ticket \(BK-1001\)$/m);
  assert.match(decodedMessage, /Content-Type: multipart\/mixed; boundary="/);
  assert.match(decodedMessage, /Content-Type: application\/pdf; name="ticket-BK-1001\.pdf"/);
  assert.match(decodedMessage, /Content-Disposition: attachment; filename="ticket-BK-1001\.pdf"/);
  assert.match(
    decodedMessage,
    new RegExp(Buffer.from('%PDF-1.4 ticket bytes').toString('base64'))
  );
});

test('buildGmailRawMessageFromEmailDraft sends a plain text/html email without a multipart wrapper when there are no attachments', async () => {
  const rawEncodedMessage = await buildGmailRawMessageFromEmailDraft({
    from: 'no-reply@masterclass.test',
    to: 'attendee@example.com',
    subject: 'Payment confirmed',
    html: '<p>Confirmed</p>',
  });

  const decodedMessage = decodeGmailRawMessage(rawEncodedMessage);

  assert.match(decodedMessage, /Content-Type: text\/html; charset="UTF-8"/);
  assert.equal(decodedMessage.includes('multipart/mixed'), false);
});

test('buildGmailRawMessageFromEmailDraft encodes a non-ASCII subject so Gmail does not reject it', async () => {
  const rawEncodedMessage = await buildGmailRawMessageFromEmailDraft({
    from: 'no-reply@masterclass.test',
    to: 'attendee@example.com',
    subject: 'Your ticket — confirmation',
    html: '<p>Confirmed</p>',
  });

  const decodedMessage = decodeGmailRawMessage(rawEncodedMessage);

  assert.match(decodedMessage, /Subject: =\?UTF-8\?B\?/);
});

test('buildGmailRawMessageFromEmailDraft refuses to build a message with no recipient', async () => {
  await assert.rejects(
    () =>
      buildGmailRawMessageFromEmailDraft({
        from: 'no-reply@masterclass.test',
        subject: 'No recipient',
        html: '<p>Nobody</p>',
      }),
    /EMAIL_RECIPIENT_MISSING/
  );
});

test('encodeGmailRawMessageFromMimeMessage emits base64url without padding', () => {
  const encodedMessage = encodeGmailRawMessageFromMimeMessage(
    Buffer.from('subject: a message that is long enough to wrap')
  );

  assert.equal(/[+/=]/.test(encodedMessage), false);
  assert.equal(
    decodeGmailRawMessage(encodedMessage),
    'subject: a message that is long enough to wrap'
  );
});

test('createGmailApiTransport sends the encoded message to the impersonated mailbox', async () => {
  const stubClient = buildGmailApiStubClient();
  const gmailTransport = await buildTransportAroundStubClient(stubClient);

  const sendResult = await gmailTransport.sendMail({
    to: 'attendee@example.com',
    subject: 'Your ticket (BK-1001)',
    html: '<p>Thanks for booking</p>',
    attachments: [
      {
        filename: 'ticket-BK-1001.pdf',
        content: Buffer.from('%PDF-1.4 ticket bytes'),
        contentType: 'application/pdf',
      },
    ],
  });

  assert.equal(stubClient.sentRequests.length, 1);
  assert.equal(stubClient.sentRequests[0].userId, 'sender@masterclass.test');
  assert.match(stubClient.sentRequests[0].requestBody.raw, /^[A-Za-z0-9_-]+$/);

  assert.equal(sendResult.messageId, 'gmail-message-1');
  assert.equal(sendResult.threadId, 'gmail-thread-1');
  assert.equal(sendResult.envelope.to, 'attendee@example.com');
});

test('createGmailApiTransport reports the Gmail daily quota failure as a named delivery error', async () => {
  const quotaExceededError = Object.assign(new Error('Requested entity exceeds quota'), {
    errors: [{ reason: 'quotaExceeded', message: 'Requested entity exceeds quota' }],
  });
  const stubClient = buildGmailApiStubClient({ throwOnSend: quotaExceededError });
  const gmailTransport = await buildTransportAroundStubClient(stubClient);

  await assert.rejects(
    () =>
      gmailTransport.sendMail({
        to: 'attendee@example.com',
        subject: 'Your ticket',
        html: '<p>Thanks</p>',
      }),
    /GMAIL_SEND_QUOTA_EXCEEDED/
  );
});

test('describeGmailSendFailure distinguishes the mailbox daily sending limit from other API errors', () => {
  const dailyLimitError = Object.assign(new Error('limit'), {
    errors: [{ reason: 'dailyLimitExceeded', message: 'Daily sending limit exceeded' }],
  });
  const genericError = Object.assign(new Error('invalid request'), {
    errors: [{ reason: 'invalidArgument', message: 'Invalid raw value' }],
  });

  assert.match(describeGmailSendFailure(dailyLimitError), /GMAIL_DAILY_SENDING_LIMIT_EXCEEDED/);
  assert.match(describeGmailSendFailure(genericError), /GMAIL_SEND_FAILED:invalid request/);
});

test('detectGmailAuthenticationStrategy prefers a service account key and falls back to an OAuth refresh token', () => {
  const previousEnvironment = { ...process.env };

  try {
    delete process.env.GMAIL_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.GMAIL_OAUTH_CLIENT_ID;
    delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
    delete process.env.GMAIL_OAUTH_REFRESH_TOKEN;

    assert.throws(() => detectGmailAuthenticationStrategy(), /GMAIL_API_CREDENTIALS_MISSING/);

    process.env.GMAIL_OAUTH_CLIENT_ID = 'client-id';
    process.env.GMAIL_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = 'refresh-token';

    assert.equal(
      detectGmailAuthenticationStrategy(),
      GMAIL_AUTHENTICATION_STRATEGY_OAUTH_REFRESH_TOKEN
    );

    process.env.GMAIL_SERVICE_ACCOUNT_EMAIL = 'sender@project.iam.gserviceaccount.com';
    process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';

    assert.equal(
      detectGmailAuthenticationStrategy(),
      GMAIL_AUTHENTICATION_STRATEGY_SERVICE_ACCOUNT
    );
  } finally {
    process.env = previousEnvironment;
  }
});

test('createGmailApiAuthenticationClient builds a service-account client that impersonates the sender mailbox with only the gmail.send scope', async () => {
  const previousEnvironment = { ...process.env };

  try {
    process.env.GMAIL_SERVICE_ACCOUNT_EMAIL = 'sender@project.iam.gserviceaccount.com';
    process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\nline-one\\nline-two\\n-----END PRIVATE KEY-----\\n';
    process.env.GMAIL_SENDER_USER = 'tickets@masterclass.test';

    const capturedJwtConfiguration = [];
    const googleApisStub = {
      auth: {
        JWT: function StubJwt(jwtConfiguration) {
          capturedJwtConfiguration.push(jwtConfiguration);
          this.jwtConfiguration = jwtConfiguration;
        },
      },
    };

    await createGmailApiAuthenticationClient({ googleApis: googleApisStub });

    const jwtConfiguration = capturedJwtConfiguration[0];
    assert.equal(jwtConfiguration.email, 'sender@project.iam.gserviceaccount.com');
    assert.equal(jwtConfiguration.subject, 'tickets@masterclass.test');
    assert.deepEqual(jwtConfiguration.scopes, [GMAIL_SEND_SCOPE]);
    assert.equal(
      jwtConfiguration.key.includes('\\n'),
      false,
      'the escaped newlines in the env value must be real newlines'
    );
    assert.equal(resolveGmailSenderAccountEmail(), 'tickets@masterclass.test');
  } finally {
    process.env = previousEnvironment;
  }
});

test('createGmailApiAuthenticationClient refuses a service account with no mailbox to impersonate', async () => {
  const previousEnvironment = { ...process.env };

  try {
    delete process.env.GMAIL_SENDER_USER;

    const googleApisStub = {
      auth: {
        JWT: function StubJwt() {},
      },
    };

    await assert.rejects(
      () =>
        createGmailApiAuthenticationClient({
          googleApis: googleApisStub,
          authenticationStrategy: GMAIL_AUTHENTICATION_STRATEGY_SERVICE_ACCOUNT,
        }),
      /GMAIL_SENDER_USER_MISSING/
    );
  } finally {
    process.env = previousEnvironment;
  }
});

test('resolveEmailTransportProviderName defaults to smtp and accepts the Gmail API provider', () => {
  const previousProvider = process.env.EMAIL_PROVIDER;

  try {
    delete process.env.EMAIL_PROVIDER;
    assert.equal(resolveEmailTransportProviderName(), 'smtp');

    process.env.EMAIL_PROVIDER = 'GMAIL_API';
    assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_GMAIL_API);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.EMAIL_PROVIDER;
    } else {
      process.env.EMAIL_PROVIDER = previousProvider;
    }
  }
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