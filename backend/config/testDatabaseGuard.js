// Test runs TRUNCATE the database they connect to, and `TRUNCATE bookings CASCADE`
// removes nineteen dependent tables at once. The suite and the dev server share
// this one pool module, so without a guard a plain `npm test` silently empties the
// real database. This module refuses the connection instead of allowing that.

const REQUIRED_TEST_DATABASE_SUFFIX = '_test';
const ALLOWED_TEST_DATABASE_SUFFIXES = ['_test', '_agent1', '_agent2', '_agent3'];

export function isRunningUnderNodeTestRunner() {
  return (
    process.env.NODE_TEST_CONTEXT !== undefined ||
    process.env.TEST_DATABASE_NAME !== undefined ||
    process.env.RUN_BSC_TESTNET_INTEGRATION === 'true'
  );
}

export function isDedicatedTestDatabaseName(databaseName) {
  return ALLOWED_TEST_DATABASE_SUFFIXES.some((allowedSuffix) =>
    databaseName.endsWith(allowedSuffix)
  );
}

export function buildUnsafeTestDatabaseMessage(databaseName) {
  return [
    `REFUSING TO RUN: the test suite would truncate the database "${databaseName}".`,
    '',
    'Every test in tests/ runs "TRUNCATE bookings CASCADE", which deletes the',
    'bookings, orders, payments, deposits_observed, sweeps, treasury_ledger and',
    'other dependent rows of that database.',
    '',
    'Run the suite against a dedicated throwaway database instead:',
    '  npm test                      # uses the DB_DATABASE set by package.json',
    '',
    'To create that database once:',
    `  createdb ${REQUIRED_TEST_DATABASE_SUFFIX ? 'masterclass_test' : ''}`,
    '  psql -d masterclass_test -f config/schema.sql',
  ].join('\n');
}

export function assertSafeTestDatabaseName(databaseName) {
  if (!isRunningUnderNodeTestRunner()) {
    return;
  }

  if (isDedicatedTestDatabaseName(databaseName)) {
    return;
  }

  throw new Error(buildUnsafeTestDatabaseMessage(databaseName));
}