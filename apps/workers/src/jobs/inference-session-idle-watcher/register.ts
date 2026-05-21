import type PgBoss from 'pg-boss';
import { handleInferenceSessionIdleWatcher } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('inference-session-idle-watcher-register');
const JOB_NAME = 'inference-session-idle-watcher';
const SCHEDULE = '*/5 * * * *'; // every 5 minutes

export async function register(boss: PgBoss): Promise<void> {
  // pg-boss v10 requires the queue to exist before scheduling/sending.
  // createQueue is idempotent — safe to call on each boot.
  await boss.createQueue(JOB_NAME);

  // Subscribe a worker to drain the queue (handler does its own paging).
  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Idle-watcher job firing', { jobId: job.id });
      await handleInferenceSessionIdleWatcher(boss);
    }
  });

  // Replace any existing schedule so a redeploy with a different cron updates cleanly.
  try {
    await boss.unschedule(JOB_NAME);
  } catch {
    // no existing schedule — ignore
  }

  await boss.schedule(JOB_NAME, SCHEDULE, {});
  log.info('Registered job handler and schedule', { jobName: JOB_NAME, schedule: SCHEDULE });
}
