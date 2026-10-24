import './environment.js';

import pg from 'pg';

import { parsePostgresConnectionUrl } from './databaseConnectionUrl.js';
import { assertSafeTestDatabaseName } from './testDatabaseGuard.js';

const IS_SERVERLESS_RUNTIME = process.env.VERCEL === '1';

// Supabase (and most managed Postgres providers) hand out one connection URL
// instead of five separate values. Accepting it keeps the Vercel setup to a
// single copied variable, while DB_HOST/DB_USER/... still work for local
// development and self-hosted installs.
const DATABASE_CONNECTION_URL_VARIABLE_NAMES = Object.freeze([
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'POSTGRES_URL',
]);

function readDatabaseConnectionUrlFromEnvironment() {
  for (const variableName of DATABASE_CONNECTION_URL_VARIABLE_NAMES) {
    const connectionUrlValue = process.env[variableName]?.trim();
    if (connectionUrlValue) {
      return connectionUrlValue;
    }
  }
  return null;
}

function isSupabaseDatabaseHost(databaseHost) {
  return /(^|\.)supabase\.(co|com|in)$/.test(String(databaseHost || ''));
}

function isLocalDatabaseHost(databaseHost) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(databaseHost || ''));
}

// The suite truncates whatever database it is given, so this check must run
// before the pool is built, not on the connection callback below.
const databaseConnectionUrl = readDatabaseConnectionUrlFromEnvironment();
const resolvedConnectionParameters = databaseConnectionUrl
  ? parsePostgresConnectionUrl(databaseConnectionUrl)
  : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

assertSafeTestDatabaseName(resolvedConnectionParameters.database);

function resolveDatabaseSslConfiguration(databaseHost) {
  const configuredSslMode = process.env.DB_SSL?.trim().toLowerCase();

  // Supabase requires TLS. Its pooler certificate is trusted by the local
  // machine but not always by the Node CA bundle in a serverless image, so the
  // default for a Supabase host is encrypted transport without CA pinning.
  // Set DB_SSL=require when the runtime does trust the provider CA.
  //
  // A connection URL that points anywhere other than loopback is treated the
  // same way: managed providers hand out one URL, so a remote URL without an
  // explicit DB_SSL should still be encrypted. Local databases keep plaintext.
  const defaultSslMode =
    isSupabaseDatabaseHost(databaseHost) ||
    (databaseConnectionUrl && !isLocalDatabaseHost(databaseHost))
      ? 'no-verify'
      : 'disable';

  const sslMode = configuredSslMode || defaultSslMode;

  if (sslMode === 'disable' || sslMode === 'false' || sslMode === 'off') {
    return false;
  }

  // Managed providers (Neon, Supabase, RDS) usually present a certificate that
  // Node does not trust out of the box. `no-verify` keeps the connection
  // encrypted without pinning the CA; `require` verifies it.
  if (sslMode === 'no-verify' || sslMode === 'allow' || sslMode === 'prefer') {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}

const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000);
const idleInTransactionTimeoutMs = Number(
  process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS || 15000
);

// Connection poolers (Supabase's Supavisor/PgBouncer, pgbouncer, pgcat)
// reject the `options` startup parameter in some configurations. A URL almost
// always points at a pooler, so it opts out by default. Set
// DB_USE_STARTUP_OPTIONS=true to force it, or false to opt out with DB_* vars.
// Without the startup options, apply the same limits at the role level:
//   ALTER ROLE CURRENT_USER SET statement_timeout = '30s';
//   ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '15s';
const startupSessionOptionsConfigured =
  process.env.DB_USE_STARTUP_OPTIONS === undefined
    ? !databaseConnectionUrl
    : process.env.DB_USE_STARTUP_OPTIONS === 'true';

const startupSessionOptions = `-c statement_timeout=${statementTimeoutMs} -c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMs}`;

// Serverless functions must keep very few connections per instance: many
// instances multiplied by a pool of ten exhausts a managed Postgres plan.
// Supabase's transaction pooler also has a low per-project client cap, so the
// serverless default stays at three.
const maximumPoolConnectionCount = Number(
  process.env.DB_POOL_MAX || (IS_SERVERLESS_RUNTIME ? 3 : 10)
);

const pool = new pg.Pool({
  host: resolvedConnectionParameters.host,
  port: resolvedConnectionParameters.port,
  database: resolvedConnectionParameters.database,
  user: resolvedConnectionParameters.user,
  password: resolvedConnectionParameters.password,
  ssl: resolveDatabaseSslConfiguration(resolvedConnectionParameters.host),
  max: maximumPoolConnectionCount,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  // A booking confirmation holds a row lock on seat_capacity. Without these
  // two limits a stuck request can hold it forever and block every booking.
  ...(startupSessionOptionsConfigured
    ? { options: startupSessionOptions }
    : {}),
  application_name: 'blockchain-masterclass',
  // Let a serverless invocation finish even if the pool still has an idle
  // socket; the next invocation reuses it if the instance is still warm.
  allowExitOnIdle: IS_SERVERLESS_RUNTIME,
});

// A probe query, not pool.connect(): a checked-out client must be released,
// otherwise the pool permanently loses one connection to the startup check.
pool
  .query('SELECT 1')
  .then(() => {
    if (!IS_SERVERLESS_RUNTIME) {
      console.log('Connected to the database');
    }
  })
  .catch((err) => console.error('Error connecting to the database', err));

export default pool;
