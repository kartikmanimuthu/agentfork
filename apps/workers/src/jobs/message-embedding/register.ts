import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleMessageEmbedding } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('message-embedding-register');
const JOB_NAME = 'message-embedding';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleMessageEmbedding);
  }

  await boss.work(JOB_NAME, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
