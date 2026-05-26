import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleInferenceSessionAnalytics } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('inference-session-analytics-register');
const JOB_NAME = 'inference-session-analytics';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  // pg-boss v10 requires explicit queue creation before send/schedule.
  // Senders (API close + delete + idle-watcher) target this queue, so the worker
  // process is the source of truth that ensures it exists.
  await boss.createQueue(JOB_NAME);

  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleInferenceSessionAnalytics);
  }

  await boss.work(JOB_NAME, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
