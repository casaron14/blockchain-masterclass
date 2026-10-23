import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isDedicatedTestDatabaseName,
  isRunningUnderNodeTestRunner,
  assertSafeTestDatabaseName,
} from '../config/testDatabaseGuard.js';

const originalNodeTestContext = process.env.NODE_TEST_CONTEXT;
const originalTestDatabaseName = process.env.TEST_DATABASE_NAME;
const originalIntegrationRun = process.env.RUN_BSC_TESTNET_INTEGRATION;

function restoreEnvironmentVariable(name, originalValue) {
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = originalValue;
}

function runWithTestRunnerEnvironment(runAssertions) {
  const previousNodeTestContext = process.env.NODE_TEST_CONTEXT;
  const previousTestDatabaseName = process.env.TEST_DATABASE_NAME;

  process.env.NODE_TEST_CONTEXT = 'child-v24';
  delete process.env.TEST_DATABASE_NAME;

  try {
    runAssertions();
  } finally {
    if (previousNodeTestContext === undefined) {
      delete process.env.NODE_TEST_CONTEXT;
    } else {
      process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
    }

    if (previousTestDatabaseName === undefined) {
      delete process.env.TEST_DATABASE_NAME;
    } else {
      process.env.TEST_DATABASE_NAME = previousTestDatabaseName;
    }
  }
}

test('the live database name is rejected as a test target', () => {
  assert.equal(isDedicatedTestDatabaseName('masterclass'), false);
});

test('a dedicated test database name is accepted as a test target', () => {
  assert.equal(isDedicatedTestDatabaseName('masterclass_test'), true);
});

test('the per-agent scratch databases are accepted as test targets', () => {
  assert.equal(isDedicatedTestDatabaseName('masterclass_agent3'), true);
});

test('a test run against the live database is refused before any pool connects', () => {
  runWithTestRunnerEnvironment(() => {
    assert.throws(
      () => assertSafeTestDatabaseName('masterclass'),
      /REFUSING TO RUN/
    );
  });
});

test('the refusal names the database that would have been truncated', () => {
  runWithTestRunnerEnvironment(() => {
    assert.throws(
      () => assertSafeTestDatabaseName('masterclass'),
      /truncate the database "masterclass"/
    );
  });
});

test('a test run against the dedicated test database is allowed', () => {
  runWithTestRunnerEnvironment(() => {
    assert.doesNotThrow(() => assertSafeTestDatabaseName('masterclass_test'));
  });
});

test('a server launch is not treated as a test run and is never blocked', () => {
  const previousNodeTestContext = process.env.NODE_TEST_CONTEXT;
  const previousTestDatabaseName = process.env.TEST_DATABASE_NAME;

  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.TEST_DATABASE_NAME;

  try {
    assert.equal(isRunningUnderNodeTestRunner(), false);
    assert.doesNotThrow(() => assertSafeTestDatabaseName('masterclass'));
  } finally {
    if (previousNodeTestContext !== undefined) {
      process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
    }
    if (previousTestDatabaseName !== undefined) {
      process.env.TEST_DATABASE_NAME = previousTestDatabaseName;
    }
  }
});

test('the guard restores the environment it borrowed', () => {
  restoreEnvironmentVariable('NODE_TEST_CONTEXT', originalNodeTestContext);
  restoreEnvironmentVariable('TEST_DATABASE_NAME', originalTestDatabaseName);
  restoreEnvironmentVariable('RUN_BSC_TESTNET_INTEGRATION', originalIntegrationRun);
});