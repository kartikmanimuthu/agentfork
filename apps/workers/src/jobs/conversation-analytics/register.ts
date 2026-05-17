import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleConversationAnalytics } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('conversation-analytics-register');
const JOB_NAME = 'conversation-analytics';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleConversationAnalytics);
  }

  await boss.work(JOB_NAME, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
