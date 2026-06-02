import type PgBoss from 'pg-boss';
import { handleExpirePausedExecutions } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('expire-paused-executions-register');
const JOB_NAME = 'expire-paused-executions';
const CRON_SCHEDULE = '30 0 * * *'; // 00:30 UTC daily (06:00 IST)

export async function register(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOB_NAME);

  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Running expiry sweep', { jobId: job.id });
      await handleExpirePausedExecutions();
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
