import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPS_SCRIPT_EMAIL_PROVIDER,
  AppsScriptEmailDeliveryError,
  buildAppsScriptEmailDeliveryRequest,
  isAppsScriptEmailDeliveryConfigured,
  parseAppsScriptEmailDeliveryResponse,
  resolveAppsScriptEmailDeliveryConfiguration,
  sendEmailThroughAppsScriptWebApp,
} from '../services/appsScriptEmailDeliveryService.js';

import {
  EMAIL_PROVIDER_APPS_SCRIPT,
  EMAIL_PROVIDER_GMAIL,
  EMAIL_PROVIDER_SMTP,
  createConfiguredEmailTransport,
  resolveEmailTransportProviderName,
  sendOutboundEmailThroughConfiguredProvider,
} from '../services/emailTransportService.js';

import { resolveTicketEmailDailyLimit } from '../services/ticketDeliveryService.js';

const TEST_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycb-test-deployment-id/exec';
const TEST_SHARED_SECRET = 'test-shared-secret-value';

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

function buildTicketOutboundEmailMessage() {
  return {
    from: { name: 'DienAcademy Events', address: 'owner@example.com' },
    to: 'attendee@example.com',
    subject: 'Your Blockchain Masterclass ticket (EVT-TEST01)',
    text: 'Your ticket is attached.',
    html: '<p>Your ticket is attached.</p>',
    attachments: [
      {
        filename: 'ticket-EVT-TEST01.png',
        content: Buffer.from('fake-png-bytes'),
        contentType: 'image/png',
      },
    ],
  };
}

function buildTicketDeliveryMetadata() {
  return {
    deliveryKey: 'ticket:EVT-TEST01',
    emailKind: 'ticket',
    booking: {
      referenceCode: 'EVT-TEST01',
      attendeeName: 'Test Attendee',
      attendeeEmailAddress: 'attendee@example.com',
      attendeePhoneNumber: '+255700000001',
      bookingStatus: 'confirmed',
    },
    event: {
      title: 'Blockchain Masterclass',
      dateLabel: '7th November 2026',
      timeLabel: '6:00 PM',
      venue: 'Arusha, Tanzania',
    },
    ticket: {
      ticketTypeLabel: 'General Admission',
      amount: 10000,
      currency: 'TZS',
    },
  };
}

test('resolveAppsScriptEmailDeliveryConfiguration requires a URL and a shared secret', () => {
  withEnvironmentVariables(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL: undefined,
      APPS_SCRIPT_SHARED_SECRET: undefined,
    },
    () => {
      assert.throws(
        () => resolveAppsScriptEmailDeliveryConfiguration(),
        (error) =>
          error instanceof AppsScriptEmailDeliveryError &&
          error.errorCode === 'APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED'
      );
      assert.equal(isAppsScriptEmailDeliveryConfigured(), false);
    }
  );
});

test('resolveAppsScriptEmailDeliveryConfiguration rejects the placeholder values from .env.example', () => {
  withEnvironmentVariables(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL:
        'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec',
      APPS_SCRIPT_SHARED_SECRET: 'replace-with-a-long-random-shared-secret',
    },
    () => {
      assert.throws(
        () => resolveAppsScriptEmailDeliveryConfiguration(),
        (error) => error.errorCode === 'APPS_SCRIPT_WEBHOOK_NOT_CONFIGURED'
      );
    }
  );
});

test('resolveAppsScriptEmailDeliveryConfiguration rejects a webhook URL that is not an Apps Script deployment', () => {
  withEnvironmentVariables(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL: 'https://collector.test/collect',
      APPS_SCRIPT_SHARED_SECRET: TEST_SHARED_SECRET,
    },
    () => {
      assert.throws(
        () => resolveAppsScriptEmailDeliveryConfiguration(),
        (error) => error.errorCode === 'APPS_SCRIPT_WEBHOOK_URL_INVALID'
      );
    }
  );
});

test('resolveAppsScriptEmailDeliveryConfiguration accepts a real deployment URL', () => {
  withEnvironmentVariables(
    {
      APPS_SCRIPT_TICKET_WEBHOOK_URL: TEST_WEBHOOK_URL,
      APPS_SCRIPT_SHARED_SECRET: TEST_SHARED_SECRET,
      APPS_SCRIPT_REQUEST_TIMEOUT_MS: '9000',
    },
    () => {
      const deliveryConfiguration = resolveAppsScriptEmailDeliveryConfiguration();

      assert.equal(deliveryConfiguration.webhookUrl, TEST_WEBHOOK_URL);
      assert.equal(deliveryConfiguration.sharedSecret, TEST_SHARED_SECRET);
      assert.equal(deliveryConfiguration.requestTimeoutMs, 9000);
      assert.equal(isAppsScriptEmailDeliveryConfigured(), true);
    }
  );
});

test('buildAppsScriptEmailDeliveryRequest converts attachments to base64 and keeps the booking mirror fields', () => {
  const deliveryRequest = buildAppsScriptEmailDeliveryRequest(
    buildTicketOutboundEmailMessage(),
    buildTicketDeliveryMetadata(),
    TEST_SHARED_SECRET
  );

  assert.equal(deliveryRequest.sharedSecret, TEST_SHARED_SECRET);
  assert.equal(deliveryRequest.emailRequest.deliveryKey, 'ticket:EVT-TEST01');
  assert.equal(deliveryRequest.emailRequest.emailKind, 'ticket');
  assert.equal(
    deliveryRequest.emailRequest.recipientEmailAddress,
    'attendee@example.com'
  );
  assert.equal(deliveryRequest.emailRequest.senderDisplayName, 'DienAcademy Events');
  assert.equal(deliveryRequest.emailRequest.replyToEmailAddress, 'support@dienacademy.com');
  assert.deepEqual(deliveryRequest.emailRequest.attachments, [
    {
      fileName: 'ticket-EVT-TEST01.png',
      mimeType: 'image/png',
      base64Content: Buffer.from('fake-png-bytes').toString('base64'),
    },
  ]);
  assert.equal(deliveryRequest.emailRequest.booking.attendeeName, 'Test Attendee');
  assert.equal(deliveryRequest.emailRequest.event.timeLabel, '6:00 PM');
  assert.equal(deliveryRequest.emailRequest.ticket.amount, 10000);
});

test('buildAppsScriptEmailDeliveryRequest refuses a missing delivery key', () => {
  assert.throws(
    () =>
      buildAppsScriptEmailDeliveryRequest(
        buildTicketOutboundEmailMessage(),
        { emailKind: 'ticket' },
        TEST_SHARED_SECRET
      ),
    (error) => error.errorCode === 'APPS_SCRIPT_DELIVERY_METADATA_MISSING'
  );
});

test('buildAppsScriptEmailDeliveryRequest refuses an attachment that is too large', () => {
  const oversizedEmailMessage = {
    ...buildTicketOutboundEmailMessage(),
    attachments: [
      {
        filename: 'ticket.png',
        content: Buffer.alloc(9 * 1024 * 1024),
        contentType: 'image/png',
      },
    ],
  };

  assert.throws(
    () =>
      buildAppsScriptEmailDeliveryRequest(
        oversizedEmailMessage,
        buildTicketDeliveryMetadata(),
        TEST_SHARED_SECRET
      ),
    (error) => error.errorCode === 'APPS_SCRIPT_ATTACHMENT_TOO_LARGE'
  );
});

test('sendEmailThroughAppsScriptWebApp posts the request and reads the delivery id', async () => {
  const recordedRequests = [];
  const fetchImplementation = async (requestUrl, requestOptions) => {
    recordedRequests.push({ requestUrl, requestOptions });
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          deliveryId: 'delivery-id-1',
          remainingDailyQuota: 88,
        }),
    };
  };

  const sendOutcome = await sendEmailThroughAppsScriptWebApp(
    buildTicketOutboundEmailMessage(),
    buildTicketDeliveryMetadata(),
    {
      deliveryConfiguration: {
        webhookUrl: TEST_WEBHOOK_URL,
        sharedSecret: TEST_SHARED_SECRET,
        requestTimeoutMs: 5000,
      },
      fetchImplementation,
    }
  );

  assert.equal(recordedRequests.length, 1);
  assert.equal(recordedRequests[0].requestUrl, TEST_WEBHOOK_URL);
  assert.equal(recordedRequests[0].requestOptions.method, 'POST');
  assert.equal(recordedRequests[0].requestOptions.redirect, 'follow');
  const postedRequestBody = JSON.parse(recordedRequests[0].requestOptions.body);
  assert.equal(postedRequestBody.sharedSecret, TEST_SHARED_SECRET);
  assert.equal(postedRequestBody.emailRequest.deliveryKey, 'ticket:EVT-TEST01');

  assert.deepEqual(sendOutcome, {
    provider: APPS_SCRIPT_EMAIL_PROVIDER,
    providerMessageId: 'delivery-id-1',
    duplicate: false,
    remainingDailyQuota: 88,
  });
});

test('parseAppsScriptEmailDeliveryResponse treats a duplicate delivery as success', () => {
  const sendOutcome = parseAppsScriptEmailDeliveryResponse(
    200,
    JSON.stringify({ ok: true, duplicate: true, deliveryId: 'delivery-id-1' })
  );

  assert.equal(sendOutcome.duplicate, true);
  assert.equal(sendOutcome.providerMessageId, 'delivery-id-1');
});

test('parseAppsScriptEmailDeliveryResponse surfaces a safe remote error code', () => {
  assert.throws(
    () =>
      parseAppsScriptEmailDeliveryResponse(
        200,
        JSON.stringify({ ok: false, error: 'daily_quota_exhausted' })
      ),
    (error) =>
      error instanceof AppsScriptEmailDeliveryError &&
      error.errorCode === 'daily_quota_exhausted'
  );
});

test('parseAppsScriptEmailDeliveryResponse never echoes an unsafe remote error string', () => {
  assert.throws(
    () =>
      parseAppsScriptEmailDeliveryResponse(
        200,
        JSON.stringify({ ok: false, error: '<script>secret</script>' })
      ),
    (error) => error.errorCode === 'APPS_SCRIPT_REMOTE_ERROR'
  );
});

test('parseAppsScriptEmailDeliveryResponse rejects a non-JSON login page', () => {
  assert.throws(
    () => parseAppsScriptEmailDeliveryResponse(200, '<html>Sign in</html>'),
    (error) => error.errorCode === 'APPS_SCRIPT_RESPONSE_NOT_JSON'
  );
});

test('parseAppsScriptEmailDeliveryResponse rejects a non-success HTTP status', () => {
  assert.throws(
    () => parseAppsScriptEmailDeliveryResponse(500, 'upstream failed'),
    (error) => error.errorCode === 'APPS_SCRIPT_HTTP_500'
  );
});

test('a delivery error never contains the shared secret or the webhook URL', async () => {
  const fetchImplementation = async () => {
    throw new Error(`connect ECONNREFUSED ${TEST_WEBHOOK_URL}`);
  };

  await assert.rejects(
    () =>
      sendEmailThroughAppsScriptWebApp(
        buildTicketOutboundEmailMessage(),
        buildTicketDeliveryMetadata(),
        {
          deliveryConfiguration: {
            webhookUrl: TEST_WEBHOOK_URL,
            sharedSecret: TEST_SHARED_SECRET,
            requestTimeoutMs: 5000,
          },
          fetchImplementation,
        }
      ),
    (error) => {
      assert.equal(error.errorCode, 'APPS_SCRIPT_REQUEST_FAILED');
      assert.ok(!error.message.includes(TEST_SHARED_SECRET));
      assert.ok(!error.message.includes(TEST_WEBHOOK_URL));
      return true;
    }
  );
});

test('resolveEmailTransportProviderName only selects Apps Script when it is configured explicitly', () => {
  withEnvironmentVariables(
    {
      EMAIL_PROVIDER: undefined,
      GMAIL_USER: undefined,
      APPS_SCRIPT_TICKET_WEBHOOK_URL: TEST_WEBHOOK_URL,
      APPS_SCRIPT_SHARED_SECRET: TEST_SHARED_SECRET,
    },
    () => {
      assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_SMTP);

      process.env.EMAIL_PROVIDER = ' apps_script ';
      assert.equal(resolveEmailTransportProviderName(), EMAIL_PROVIDER_APPS_SCRIPT);
    }
  );
});

test('createConfiguredEmailTransport refuses Apps Script because it uses a webhook', async () => {
  await assert.rejects(
    () => createConfiguredEmailTransport({ providerName: EMAIL_PROVIDER_APPS_SCRIPT }),
    /EMAIL_PROVIDER_APPS_SCRIPT_USES_WEBHOOK/
  );
});

test('createConfiguredEmailTransport still names every supported provider in its error', async () => {
  await assert.rejects(
    () => createConfiguredEmailTransport({ providerName: 'gmail_api' }),
    /Use "apps_script", "gmail" or "smtp"/
  );
});

test('sendOutboundEmailThroughConfiguredProvider routes Apps Script messages to the web app', async () => {
  const recordedRequests = [];
  const fetchImplementation = async (requestUrl, requestOptions) => {
    recordedRequests.push({ requestUrl, requestOptions });
    return {
      status: 200,
      text: async () =>
        JSON.stringify({ ok: true, deliveryId: 'delivery-id-9', remainingDailyQuota: 80 }),
    };
  };

  const sendOutcome = await sendOutboundEmailThroughConfiguredProvider(
    buildTicketOutboundEmailMessage(),
    {
      providerName: EMAIL_PROVIDER_APPS_SCRIPT,
      deliveryMetadata: buildTicketDeliveryMetadata(),
      fetchImplementation,
      deliveryConfiguration: {
        webhookUrl: TEST_WEBHOOK_URL,
        sharedSecret: TEST_SHARED_SECRET,
        requestTimeoutMs: 5000,
      },
    }
  );

  assert.equal(recordedRequests.length, 1);
  assert.equal(sendOutcome.providerMessageId, 'delivery-id-9');
});

test('sendOutboundEmailThroughConfiguredProvider still uses Nodemailer for SMTP', async () => {
  const recordedMessages = [];
  const sendOutcome = await sendOutboundEmailThroughConfiguredProvider(
    buildTicketOutboundEmailMessage(),
    {
      providerName: EMAIL_PROVIDER_SMTP,
      transport: {
        async sendMail(outboundEmailMessage) {
          recordedMessages.push(outboundEmailMessage);
          return { messageId: 'smtp-message-id' };
        },
      },
    }
  );

  assert.equal(recordedMessages.length, 1);
  assert.equal(sendOutcome.provider, EMAIL_PROVIDER_SMTP);
  assert.equal(sendOutcome.providerMessageId, 'smtp-message-id');
});

test('resolveTicketEmailDailyLimit guards a consumer Google account at 90 per day', () => {
  withEnvironmentVariables(
    {
      EMAIL_PROVIDER: EMAIL_PROVIDER_APPS_SCRIPT,
      TICKET_EMAIL_DAILY_LIMIT: undefined,
    },
    () => {
      assert.equal(resolveTicketEmailDailyLimit(), 90);
    }
  );

  withEnvironmentVariables(
    {
      EMAIL_PROVIDER: EMAIL_PROVIDER_GMAIL,
      TICKET_EMAIL_DAILY_LIMIT: undefined,
    },
    () => {
      assert.equal(resolveTicketEmailDailyLimit(), 500);
    }
  );
});
