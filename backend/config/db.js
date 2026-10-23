import './environment.js';

import pg from 'pg';

import { assertSafeTestDatabaseName } from './testDatabaseGuard.js';

// The suite truncates whatever database it is given, so this check must run
// before the pool is built, not on the connection callback below.
assertSafeTestDatabaseName(process.env.DB_DATABASE);

const IS_SERVERLESS_RUNTIME = process.env.VERCEL === '1';

function resolveDatabaseSslConfiguration() {
  const sslMode = String(process.env.DB_SSL || 'disable').toLowerCase();

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

// Serverless functions must keep very few connections per instance: many
// instances multiplied by a pool of ten exhausts a managed Postgres plan.
const maximumPoolConnectionCount = Number(
  process.env.DB_POOL_MAX || (IS_SERVERLESS_RUNTIME ? 3 : 10)
);

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: resolveDatabaseSslConfiguration(),
  max: maximumPoolConnectionCount,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  // A booking confirmation holds a row lock on seat_capacity. Without these
  // two limits a stuck request can hold it forever and block every booking.
  options: `-c statement_timeout=${statementTimeoutMs} -c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMs}`,
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
