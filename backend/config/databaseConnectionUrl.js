export function parsePostgresConnectionUrl(databaseConnectionUrl) {
  const parsedConnectionUrl = new URL(databaseConnectionUrl);
  if (!['postgres:', 'postgresql:'].includes(parsedConnectionUrl.protocol)) {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL connection URL from Supabase Connect, not the Supabase project API URL'
    );
  }

  const databaseName = decodeURIComponent(
    parsedConnectionUrl.pathname.replace(/^\//, '')
  );
  const databaseUserName = decodeURIComponent(parsedConnectionUrl.username);
  const databasePassword = decodeURIComponent(parsedConnectionUrl.password);

  if (
    !parsedConnectionUrl.hostname ||
    !databaseName ||
    !databaseUserName ||
    !databasePassword
  ) {
    throw new Error(
      'DATABASE_URL must include the PostgreSQL host, database, username, and password'
    );
  }

  return {
    host: parsedConnectionUrl.hostname,
    port: parsedConnectionUrl.port ? Number(parsedConnectionUrl.port) : 5432,
    database: databaseName,
    user: databaseUserName,
    password: databasePassword,
  };
}
