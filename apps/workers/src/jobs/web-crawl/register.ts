import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleWebCrawl } from './handler.js';
import { createLogger } from '../../lib/logger.js';
import { getPrismaClient } from '@chatbot/shared/workers';

const log = createLogger('web-crawl-register');
const BASE_JOB_NAME = 'web-crawl';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(BASE_JOB_NAME, (data) => handleWebCrawl(data, boss));
  }

  await boss.createQueue(BASE_JOB_NAME);
  await boss.work(BASE_JOB_NAME, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      log.info({ jobId: job.id }, 'Processing job');
      await executor.execute(BASE_JOB_NAME, job.data);
    }
  });

  // Register workers for scheduled sources with unique queue names
  const db = getPrismaClient();
  const sources = await db.dataSource.findMany({
    where: { type: 'URL', syncSchedule: { not: null } },
    include: { knowledgeBase: { select: { tenantId: true } } },
  });

  for (const source of sources) {
    const jobName = `${BASE_JOB_NAME}:${source.id}`;
    try {
      if (executor.registerHandler) {
        executor.registerHandler(jobName, (data) => handleWebCrawl(data, boss));
      }
      await boss.createQueue(jobName);
      await boss.work(jobName, { batchSize: 2 }, async (jobs) => {
        for (const job of jobs) {
          log.info({ jobId: job.id, jobName }, 'Processing scheduled job');
          await executor.execute(jobName, job.data);
        }
      });
      log.info({ jobName, dataSourceId: source.id }, 'Registered scheduled worker');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error({ dataSourceId: source.id, errorMessage: error.message, errorStack: error.stack }, 'Failed to register scheduled worker');
    }
  }

  log.info({ jobName: BASE_JOB_NAME }, 'Registered job handler');
}
