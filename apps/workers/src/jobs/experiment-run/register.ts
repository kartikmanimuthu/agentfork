import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleExperimentRun } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('experiment-run-register');
const JOB_NAME = 'experiment-run';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  await boss.createQueue(JOB_NAME);

  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleExperimentRun);
  }

  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info({ jobId: job.id }, 'Processing experiment run job');
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info({ jobName: JOB_NAME }, 'Registered experiment run job');
}
