import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleEvaluatorRun } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('evaluator-run-register');
const JOB_NAME = 'evaluator-run';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  await boss.createQueue(JOB_NAME);

  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleEvaluatorRun);
  }

  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info({ jobId: job.id }, 'Processing evaluator run job');
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info({ jobName: JOB_NAME }, 'Registered evaluator run job');
}
