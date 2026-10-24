import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePostgresConnectionUrl } from '../config/databaseConnectionUrl.js';

test('parses a Supabase PostgreSQL connection URL and decodes credentials', () => {
  const parsedConnectionParameters = parsePostgresConnectionUrl(
    'postgresql://postgres.project-ref:p%40ss%23word@pooler.supabase.com:6543/postgres'
  );

  assert.deepEqual(parsedConnectionParameters, {
    host: 'pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.project-ref',
    password: 'p@ss#word',
  });
});

test('rejects a Supabase project API URL as a PostgreSQL connection URL', () => {
  assert.throws(
    () => parsePostgresConnectionUrl('https://project-ref.supabase.co'),
    /DATABASE_URL must be a PostgreSQL connection URL/
  );
});

test('rejects PostgreSQL URLs missing connection credentials', () => {
  assert.throws(
    () => parsePostgresConnectionUrl('postgresql://pooler.supabase.com/postgres'),
    /must include the PostgreSQL host, database, username, and password/
  );
});
