/**
 * claw-scheduler tick handler — drives one due scheduled task.
 *
 * @chatbot/claw-studio is imported dynamically (matching claw-gateway-run) so
 * LangGraph and the model SDKs only load when a scheduled task actually fires,
 * not at worker boot for every other job type.
 */

import { createLogger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { clawSchedulerTickSchema } from './schema.js';

const log = createLogger('claw-scheduler-tick');

export async function handleClawSchedulerTick(data: unknown): Promise<void> {
  const { taskId, tenantId, scheduledAt } = clawSchedulerTickSchema.parse(data);

  try {
    const { runScheduledTask } = await import('@chatbot/claw-studio');
    const result = await runScheduledTask({
      taskId,
      tenantId,
      scheduledAt,
      deps: { dashboardBaseUrl: env.MISSION_CONTROL_URL },
    });

    if (result.skipped) {
      log.info('Scheduled tick skipped', { taskId, tenantId, reason: result.reason });
      return;
    }
    log.info('Scheduled run finished', { taskId, tenantId, runId: result.runId });
  } catch (error) {
    // runScheduledTask already recorded the outcome on the run and delivered the
    // failure digest; rethrow so the queue records it too.
    log.error('Scheduled tick failed', {
      taskId,
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
