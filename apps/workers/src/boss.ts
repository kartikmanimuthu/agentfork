import PgBoss from 'pg-boss';
import { env } from './env';

export function createBoss(): PgBoss {
  return new PgBoss({
    connectionString: env.DATABASE_URL,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInHours: 4,
    archiveCompletedAfterSeconds: 86400,
    deleteAfterDays: 7,
    monitorStateIntervalSeconds: 30,
  });
}
