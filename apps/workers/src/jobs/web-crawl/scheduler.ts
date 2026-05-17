import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('web-crawl-scheduler');
const BASE_JOB_NAME = 'web-crawl';

export async function registerSchedules(boss: PgBoss): Promise<void> {
  const db = getPrismaClient();
  const sources = await db.dataSource.findMany({
    where: { type: 'URL', syncSchedule: { not: null } },
    include: { knowledgeBase: { select: { tenantId: true } } },
  });

  for (const source of sources) {
    const jobName = `${BASE_JOB_NAME}:${source.id}`;
    try {
      await boss.schedule(jobName, source.syncSchedule!, {
        dataSourceId: source.id,
        tenantId: source.knowledgeBase.tenantId,
        knowledgeBaseId: source.knowledgeBaseId,
      });
      log.info({ dataSourceId: source.id, schedule: source.syncSchedule, jobName }, 'Scheduled recurring crawl');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error({ dataSourceId: source.id, errorMessage: error.message, errorStack: error.stack }, 'Failed to schedule crawl');
    }
  }
}
