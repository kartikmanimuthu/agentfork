/**
 * queue.ts — Mission Control's side of the gateway queue.
 *
 * Only ever sends; the worker owns consumption. A single pg-boss instance is
 * cached on globalThis so dev hot reload doesn't open a new connection pool per
 * request, and `start()` is memoised through the same promise so concurrent
 * inbound webhooks don't race to initialise it.
 */

import PgBoss from 'pg-boss';
import { createLogger } from '@chatbot/shared';
import type { GatewayJobPayload } from '@chatbot/claw-studio';
import { env } from './env';

const logger = createLogger('mission-control:queue');

export const CLAW_GATEWAY_RUN_QUEUE = 'claw-gateway-run';
export const CLAW_SCHEDULER_TICK_QUEUE = 'claw-scheduler-tick';

/** A Claw run can legitimately take many minutes; the default expiry would let
 *  pg-boss reclaim a job that is still executing. */
const EXPIRE_IN_MINUTES = 30;

const g = globalThis as typeof globalThis & { _clawBoss?: Promise<PgBoss> };

async function getBoss(): Promise<PgBoss> {
  if (!g._clawBoss) {
    g._clawBoss = (async () => {
      const boss = new PgBoss({ connectionString: env.DATABASE_URL });
      boss.on('error', (error) => logger.error({ error }, 'pg-boss error'));
      await boss.start();
      // Idempotent — the worker creates these too, but Mission Control may boot
      // first and sending to a missing queue throws.
      await boss.createQueue(CLAW_GATEWAY_RUN_QUEUE);
      await boss.createQueue(CLAW_SCHEDULER_TICK_QUEUE);
      logger.info('pg-boss send client ready');
      return boss;
    })().catch((error) => {
      // Don't cache a failed start, or every later request inherits the failure.
      g._clawBoss = undefined;
      throw error;
    });
  }
  return g._clawBoss;
}

/**
 * Enqueues a gateway run.
 *
 * `retryLimit: 0` is deliberate: a Claw run that failed halfway may already have
 * posted messages to Slack or Telegram and mutated things through its tools, so
 * replaying it automatically could duplicate side effects. Failures surface on
 * the run record instead, where a human decides.
 */
/**
 * Fires a scheduled task immediately ("Run now"). Goes through the same tick queue
 * and the same `(taskId, scheduledAt)` lock as a real sweep, so a manual trigger and
 * a naturally-due tick in the same minute can't both launch the task.
 */
export async function enqueueScheduledTick(payload: {
  taskId: string;
  tenantId: string;
  scheduledAt: string;
}): Promise<void> {
  try {
    const boss = await getBoss();
    const jobId = await boss.send(CLAW_SCHEDULER_TICK_QUEUE, payload, {
      singletonKey: `claw-task:${payload.taskId}`,
      singletonSeconds: 60,
      retryLimit: 0,
      expireInMinutes: EXPIRE_IN_MINUTES,
    });
    logger.info({ jobId, ...payload }, 'Scheduled tick enqueued');
  } catch (error) {
    logger.error({ error, taskId: payload.taskId }, 'Failed to enqueue scheduled tick');
    throw error;
  }
}

export async function enqueueGatewayRun(payload: GatewayJobPayload): Promise<void> {
  try {
    const boss = await getBoss();
    const jobId = await boss.send(CLAW_GATEWAY_RUN_QUEUE, payload, {
      retryLimit: 0,
      expireInMinutes: EXPIRE_IN_MINUTES,
    });
    logger.info(
      { jobId, runId: payload.runId, tenantId: payload.tenantId, action: payload.action ?? null },
      'Gateway run enqueued',
    );
  } catch (error) {
    logger.error({ error, runId: payload.runId }, 'Failed to enqueue gateway run');
    throw error;
  }
}
