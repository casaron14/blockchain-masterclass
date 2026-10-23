// Builds the Google credentials the Gmail API is called with.
//
// Two authentication strategies are supported, and the environment decides
// which one is used:
//
//   1. A service-account key plus a sender mailbox (GMAIL_SERVICE_ACCOUNT_EMAIL
//      + GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY + GMAIL_SENDER_USER). This is the
//      documented Google path for sending as a Workspace user: the service
//      account impersonates GMAIL_SENDER_USER through domain-wide delegation,
//      so the mailbox must belong to the same Workspace and the service account
//      client id must be authorised for the gmail.send scope in the Admin
//      console.
//
//   2. A pre-consented OAuth2 refresh token (GMAIL_OAUTH_CLIENT_ID +
//      GMAIL_OAUTH_CLIENT_SECRET + GMAIL_OAUTH_REFRESH_TOKEN). Created once by
//      running Google's OAuth consent flow as the sending mailbox; afterwards
//      the refresh token is long-lived and needs no browser.
//
// Either way the resulting client only ever carries the gmail.send scope, so it
// cannot read, list or delete mail.

import { loadGmailApiModule } from './gmailApiModuleLoader.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export const GMAIL_AUTHENTICATION_STRATEGY_SERVICE_ACCOUNT =
  'gmail_service_account';
export const GMAIL_AUTHENTICATION_STRATEGY_OAUTH_REFRESH_TOKEN =
  'gmail_oauth_refresh_token';

function readPrivateKeyValue() {
  const rawPrivateKey = process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY ?? '';
  // A PEM pasted into an env file arrives with literal "\n" sequences rather
  // than real newlines, which the JWT signer rejects.
  return rawPrivateKey.replace(/\\n/g, '\n');
}

function areServiceAccountCredentialsPresent() {
  return Boolean(
    process.env.GMAIL_SERVICE_ACCOUNT_EMAIL &&
      readPrivateKeyValue()
  );
}

function areRefreshTokenCredentialsPresent() {
  return Boolean(
    process.env.GMAIL_OAUTH_CLIENT_ID &&
      process.env.GMAIL_OAUTH_CLIENT_SECRET &&
      process.env.GMAIL_OAUTH_REFRESH_TOKEN
  );
}

export function resolveGmailSenderAccountEmail() {
  return process.env.GMAIL_SENDER_USER || 'me';
}

export function resolveGmailSenderDisplayAddress() {
  return process.env.MAIL_FROM || null;
}

export function detectGmailAuthenticationStrategy() {
  if (areServiceAccountCredentialsPresent()) {
    return GMAIL_AUTHENTICATION_STRATEGY_SERVICE_ACCOUNT;
  }

  if (areRefreshTokenCredentialsPresent()) {
    return GMAIL_AUTHENTICATION_STRATEGY_OAUTH_REFRESH_TOKEN;
  }

  throw new Error(
    'GMAIL_API_CREDENTIALS_MISSING: set GMAIL_SERVICE_ACCOUNT_EMAIL and ' +
      'GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY (plus GMAIL_SENDER_USER for domain-wide ' +
      'delegation), or set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET and ' +
      'GMAIL_OAUTH_REFRESH_TOKEN.'
  );
}

async function createServiceAccountAuthenticationClient(googleApisLibrary) {
  const senderAccountEmail = process.env.GMAIL_SENDER_USER;

  if (!senderAccountEmail) {
    throw new Error(
      'GMAIL_SENDER_USER_MISSING: a service-account key can only send as a ' +
        'Workspace mailbox, so GMAIL_SENDER_USER must name the mailbox to impersonate.'
    );
  }

  return new googleApisLibrary.auth.JWT({
    email: process.env.GMAIL_SERVICE_ACCOUNT_EMAIL,
    key: readPrivateKeyValue(),
    scopes: [GMAIL_SEND_SCOPE],
    subject: senderAccountEmail,
  });
}

async function createRefreshTokenAuthenticationClient(googleApisLibrary) {
  const oauthClient = new googleApisLibrary.auth.OAuth2(
    process.env.GMAIL_OAUTH_CLIENT_ID,
    process.env.GMAIL_OAUTH_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  oauthClient.setCredentials({
    refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN,
  });

  return oauthClient;
}

export async function createGmailApiAuthenticationClient(options = {}) {
  const googleApisLibrary = options.googleApis ?? (await loadGmailApiModule());
  const authenticationStrategy =
    options.authenticationStrategy ?? detectGmailAuthenticationStrategy();

  if (authenticationStrategy === GMAIL_AUTHENTICATION_STRATEGY_SERVICE_ACCOUNT) {
    return createServiceAccountAuthenticationClient(googleApisLibrary);
  }

  if (
    authenticationStrategy === GMAIL_AUTHENTICATION_STRATEGY_OAUTH_REFRESH_TOKEN
  ) {
    return createRefreshTokenAuthenticationClient(googleApisLibrary);
  }

  throw new Error(
    `GMAIL_AUTHENTICATION_STRATEGY_UNSUPPORTED:${authenticationStrategy}`
  );
}