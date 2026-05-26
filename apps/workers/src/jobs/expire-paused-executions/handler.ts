import { getPrismaClient } from '@chatbot/shared/workers';
import { PausedExecutionService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('expire-paused-executions');

export async function handleExpirePausedExecutions(): Promise<void> {
  const db = getPrismaClient();
  const svc = new PausedExecutionService(db as any);
  const count = await svc.expireOld();

  if (count > 0) {
    const expired = await (db as any).pausedExecution.findMany({
      where: { resumedAt: { not: null }, expiresAt: { lt: new Date() } },
      select: { executionId: true },
      take: 500,
    });
    for (const { executionId } of expired) {
      await (db as any).apiKeyExecution.updateMany({
        where: { id: executionId, status: 'paused' },
        data: { status: 'failed', error: 'Human input timeout — resume token expired', completedAt: new Date() },
      });
    }
  }

  log.info({ expiredCount: count }, 'Expired paused executions swept');
}
