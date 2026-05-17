import PgBoss from 'pg-boss';

/**
 * Creates a pg-boss instance for use in API routes (e.g. enqueuing ingestion jobs).
 * Uses the same DATABASE_URL as the rest of the app.
 */
export function createBoss(): PgBoss {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  return new PgBoss({
    connectionString,
    retryLimit: 10,
    retryDelay: 30,
    retryBackoff: true,
    expireInHours: 4,
    archiveCompletedAfterSeconds: 86400,
    deleteAfterDays: 7,
  });
}
