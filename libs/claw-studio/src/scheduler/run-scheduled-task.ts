/**
 * run-scheduled-task.ts — turns one due tick into a real Claw run.
 *
 * No worker→HTTP hop. Nucleus's sweeper POSTs to a web-ui trigger endpoint because
 * its agent code lives in web-ui; here `libs/claw-studio` imports directly into
 * `apps/workers` (as `claw-gateway-run` already does), so the tick creates and drives
 * the run in-process. That removes a network hop, the INTERNAL_API_KEY shared secret,
 * and a whole class of 401-misconfig failures that silently drop scheduled runs.
 *
 * `executeRun` is reused unchanged — it was already source-agnostic, which is the
 * entire reason scheduling is cheap here.
 */

import { createLogger } from '@chatbot/shared';
import { executeRun } from '../gateway/execute-run';
import { getRunService } from '../gateway/run-service';
import type { RouterDeps } from '../gateway/notification-router';
import { getOrCreateClawConversation } from '../agent/claw-runtime';
import { SCHEDULED_SOURCE } from '../gateway/types';
import { finalizeScheduledRun } from './scheduled-notifier';
import { ScheduledTaskService, completeOnceTask, tryAcquireLock } from './scheduled-task-service';

const logger = createLogger('claw-studio:scheduler:run');

export interface RunScheduledTaskInput {
  tenantId: string;
  taskId: string;
  /** Minute-resolution stamp used as the lock key, so one due minute runs once. */
  scheduledAt: string;
  deps: RouterDeps;
}

export interface RunScheduledTaskResult {
  skipped: boolean;
  reason?: 'locked' | 'not-active' | 'missing';
  runId?: string;
}

export async function runScheduledTask(
  input: RunScheduledTaskInput,
): Promise<RunScheduledTaskResult> {
  const { tenantId, taskId, scheduledAt, deps } = input;

  try {
    // Cross-replica guard: the unique index on (taskId, scheduledAt) means the
    // loser of a race simply does not run.
    if (!(await tryAcquireLock(taskId, scheduledAt))) {
      logger.info({ taskId, scheduledAt }, 'Lock held elsewhere — skipping tick');
      return { skipped: true, reason: 'locked' };
    }

    const service = new ScheduledTaskService(tenantId);
    const task = await service.get(taskId);
    if (!task) {
      logger.warn({ taskId, tenantId }, 'Scheduled task not found — skipping tick');
      return { skipped: true, reason: 'missing' };
    }
    if (task.status !== 'active') {
      logger.info({ taskId, status: task.status }, 'Task not active — skipping tick');
      return { skipped: true, reason: 'not-active' };
    }

    // 'main' reuses the Claw's own thread so a recurring reminder remembers prior
    // runs. 'isolated' omits threadId entirely and lets the run service default to
    // its per-run thread — right for reports, and it keeps runId generation in one
    // place rather than duplicating it here.
    const mainThreadId = task.sessionMode === 'main'
      ? (await getOrCreateClawConversation(task.clawId)).threadId
      : undefined;

    const run = await getRunService().create({
      tenantId,
      source: SCHEDULED_SOURCE,
      taskDescription: task.prompt,
      ...(mainThreadId ? { threadId: mainThreadId } : {}),
      trigger: { taskId: task.taskId, taskName: task.name, scheduledAt },
    });
    const runId = run.runId;

    logger.info(
      { taskId, runId, tenantId, sessionMode: task.sessionMode, approvalMode: task.approvalMode },
      'Scheduled run created',
    );

    try {
      await executeRun({
        runId,
        deps,
        runtimeOverrides: {
          approvalPolicy: { mode: task.approvalMode, allowedTools: task.allowedTools },
          maxIterations: task.maxIterations ?? undefined,
          providerModelId: task.providerModelId ?? undefined,
          promptSurface: 'scheduled',
        },
      });
    } finally {
      // Runs even when executeRun throws, so lastRun* and the digest are never
      // skipped on a failure — that outcome is exactly what the user needs told.
      const finished = (await getRunService().get(runId)) ?? run;
      await finalizeScheduledRun(finished);
      if (task.scheduleType === 'once') await completeOnceTask(taskId);
    }

    return { skipped: false, runId };
  } catch (error) {
    logger.error({ error, taskId, tenantId }, 'runScheduledTask failed');
    throw error;
  }
}
