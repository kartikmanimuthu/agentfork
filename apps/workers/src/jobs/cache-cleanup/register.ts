import type PgBoss from 'pg-boss';
import { handleCacheCleanup } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('cache-cleanup-register');
const JOB_NAME = 'cache-cleanup';
const CRON_SCHEDULE = '15 * * * *'; // hourly at :15

export async function register(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOB_NAME);

  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Running cache cleanup', { jobId: job.id });
      await handleCacheCleanup();
    }
  });

  try {
    await boss.unschedule(JOB_NAME);
  } catch {
    // no existing schedule
  }

  await boss.schedule(JOB_NAME, CRON_SCHEDULE, {});
  log.info('Registered cron job', { jobName: JOB_NAME, schedule: CRON_SCHEDULE });
}
