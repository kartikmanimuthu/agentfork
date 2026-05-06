import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('web-crawl-scheduler');

export async function registerSchedules(boss: PgBoss): Promise<void> {
  const db = getPrismaClient();
  const sources = await db.dataSource.findMany({
    where: { type: 'URL', syncSchedule: { not: null } },
    include: { knowledgeBase: { select: { tenantId: true } } },
  });

  for (const source of sources) {
    try {
      // Note: pg-boss schedule table uses `name` as PRIMARY KEY, so calling
      // schedule() multiple times with the same job name overwrites the data.
      // If multiple URL data sources have syncSchedule, only the last one's
      // schedule will be retained. To support multiple concurrent schedules,
      // use unique job names per data source (e.g. `web-crawl:${source.id}`)
      // and register corresponding workers.
      await boss.schedule('web-crawl', source.syncSchedule!, {
        dataSourceId: source.id,
        tenantId: source.knowledgeBase.tenantId,
        knowledgeBaseId: source.knowledgeBaseId,
      });
      log.info('Scheduled recurring crawl', { dataSourceId: source.id, schedule: source.syncSchedule });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to schedule crawl', { dataSourceId: source.id, error: message });
    }
  }
}
