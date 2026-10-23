import '../config/environment.js';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pool from '../config/db.js';

const backendRootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const BOOTSTRAP_SCHEMA_PATH = path.join(backendRootDirectory, 'config/schema.sql');
const MIGRATIONS_DIRECTORY_PATH = path.join(backendRootDirectory, 'migrations');

function computeSqlChecksum(sqlText) {
  return crypto.createHash('sha256').update(sqlText).digest('hex');
}

async function createMigrationLedgerTable(databaseClient) {
  await databaseClient.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function recordAppliedMigration(databaseClient, migrationName, checksum) {
  await databaseClient.query(
    `INSERT INTO schema_migrations (name, checksum)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
       SET checksum = EXCLUDED.checksum,
           applied_at = now()`,
    [migrationName, checksum]
  );
}

// The bootstrap schema is written with IF NOT EXISTS / DO guards, so it is safe
// (and useful) to replay it on every deploy: a fresh database becomes complete
// and an existing one picks up any newly added table or column.
async function applyBootstrapSchema(databaseClient) {
  const bootstrapSql = await fs.readFile(BOOTSTRAP_SCHEMA_PATH, 'utf8');
  await databaseClient.query(bootstrapSql);
  await recordAppliedMigration(
    databaseClient,
    'bootstrap:config/schema.sql',
    computeSqlChecksum(bootstrapSql)
  );
  console.log('Applied bootstrap schema: config/schema.sql');
}

async function listPendingMigrationFileNames() {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(MIGRATIONS_DIRECTORY_PATH, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function applyPendingMigrationFiles(databaseClient) {
  const pendingMigrationFileNames = await listPendingMigrationFileNames();

  for (const migrationFileName of pendingMigrationFileNames) {
    const migrationFilePath = path.join(MIGRATIONS_DIRECTORY_PATH, migrationFileName);
    const migrationSql = await fs.readFile(migrationFilePath, 'utf8');
    const migrationChecksum = computeSqlChecksum(migrationSql);

    const existingMigrationResult = await databaseClient.query(
      'SELECT checksum FROM schema_migrations WHERE name = $1',
      [migrationFileName]
    );

    if (existingMigrationResult.rows.length > 0) {
      if (existingMigrationResult.rows[0].checksum !== migrationChecksum) {
        throw new Error(
          `Migration ${migrationFileName} was modified after it was applied. ` +
            'Add a new migration instead of editing an applied one.'
        );
      }
      continue;
    }

    await databaseClient.query('BEGIN');
    try {
      await databaseClient.query(migrationSql);
      await recordAppliedMigration(databaseClient, migrationFileName, migrationChecksum);
      await databaseClient.query('COMMIT');
      console.log(`Applied migration: ${migrationFileName}`);
    } catch (error) {
      await databaseClient.query('ROLLBACK');
      throw new Error(`Migration ${migrationFileName} failed: ${error.message}`);
    }
  }
}

async function runDatabaseMigrations() {
  const databaseClient = await pool.connect();

  try {
    await createMigrationLedgerTable(databaseClient);
    await applyBootstrapSchema(databaseClient);
    await applyPendingMigrationFiles(databaseClient);
    console.log('Database migrations completed.');
  } finally {
    databaseClient.release();
    await pool.end();
  }
}

runDatabaseMigrations().catch(async (error) => {
  console.error('Database migration failed:', error.message);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
