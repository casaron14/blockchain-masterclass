import pool from '../config/db.js';

// The first event is archived in production because it has already happened.
// The isolated test suite still exercises the original single-event booking
// flows through the bare endpoints, so the test database keeps that event open.
async function openPrimaryEventForIsolatedTestSuite() {
  const testDatabaseName = process.env.DB_DATABASE ?? '';
  if (!testDatabaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to change event lifecycle outside a test database: ${testDatabaseName}`
    );
  }

  await pool.query(
    "UPDATE events SET status = 'open' WHERE slug = 'blockchain-masterclass'"
  );
  console.log('Primary event opened for the isolated test suite');
}

openPrimaryEventForIsolatedTestSuite()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error.message);
    await pool.end();
    process.exitCode = 1;
  });
