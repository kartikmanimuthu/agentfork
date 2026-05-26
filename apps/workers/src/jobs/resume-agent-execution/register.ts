import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleResumeAgentExecution } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('resume-agent-execution-register');
const JOB_NAME = 'resume-agent-execution';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleResumeAgentExecution);
  }

  await boss.createQueue(JOB_NAME);
  await boss.work(JOB_NAME, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing resume job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
