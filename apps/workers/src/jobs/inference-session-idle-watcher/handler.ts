import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('inference-session-idle-watcher');

const ANALYTICS_JOB = 'inference-session-analytics';
const PAGE_SIZE = 100;

/**
 * Sweeps active sessions whose idleExpiresAt has passed and ends them with reason
 * "idle_timeout". For each session ended, enqueues the analytics job. Designed to be
 * scheduled every 5 minutes by pg-boss; safe under concurrent invocations because
 * `updateMany` filters on status='active' so only one watcher will succeed in the
 * transition for a given row.
 */
export async function handleInferenceSessionIdleWatcher(boss: PgBoss): Promise<void> {
  const prisma = getPrismaClient();
  const now = new Date();

  let totalEnded = 0;

  while (true) {
    const stale = await prisma.inferenceSession.findMany({
      where: {
        status: 'active',
        idleExpiresAt: { lt: now },
      },
      select: { id: true, tenantId: true },
      orderBy: { idleExpiresAt: 'asc' },
      take: PAGE_SIZE,
    });

    if (stale.length === 0) break;

    for (const row of stale) {
      // Filter on status='active' so concurrent watchers can't double-end a row.
      const result = await prisma.inferenceSession.updateMany({
        where: { id: row.id, status: 'active' },
        data: {
          status: 'ended',
          endedAt: new Date(),
          endReason: 'idle_timeout',
        },
      });

      if (result.count > 0) {
        await boss.send(ANALYTICS_JOB, { sessionId: row.id, tenantId: row.tenantId });
        totalEnded += 1;
      }
    }

    if (stale.length < PAGE_SIZE) break;
  }

  if (totalEnded > 0) {
    log.info('Idle-watcher completed sweep', { totalEnded });
  }
}
