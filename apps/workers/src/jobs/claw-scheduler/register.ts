/**
 * claw-scheduler — one sweeper, one queue, unlimited tasks.
 *
 * Ported from nucleus `agent-ops-scheduler`, which already hit and fixed the naive
 * design: `pgboss.schedule` is keyed by queue name, so per-task cron forces one
 * queue AND one `work()` poller per task. At N tasks that is N indexed SELECTs per
 * second doing nothing, plus a consumer/queue leak every time a task is deleted.
 *
 * Instead: evaluate cron in-app on a timer and multiplex every tenant's due tasks
 * onto a single tick queue.
 */

import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { createLogger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { handleClawSchedulerTick } from './handler.js';
import type { ClawSchedulerTick } from './schema.js';

const log = createLogger('claw-scheduler');

export const CLAW_SCHEDULER_TICK_QUEUE = 'claw-scheduler-tick';

/** A Claw run can take many minutes; the pg-boss default would reclaim it mid-flight. */
const EXPIRE_IN_MINUTES = 30;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

/** Minute-resolution stamp: the lock key that makes one due minute run once. */
function minuteStamp(nowMs: number): string {
  return new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString();
}

export async function sweep(boss: PgBoss): Promise<void> {
  if (sweepInFlight) {
    log.debug('Sweep skipped — previous sweep still in flight');
    return;
  }
  sweepInFlight = true;
  try {
    const { selectDueTasks, listAllActiveTasks, advanceIntervalAnchor, DUE_WINDOW_MS } =
      await import('@chatbot/claw-studio');

    const nowMs = Date.now();
    const active = await listAllActiveTasks();
    const due = selectDueTasks(active, nowMs, DUE_WINDOW_MS);
    if (due.length === 0) return;

    const scheduledAt = minuteStamp(nowMs);

    for (const task of due) {
      try {
        await boss.send(
          CLAW_SCHEDULER_TICK_QUEUE,
          { taskId: task.taskId, tenantId: task.tenantId, scheduledAt } satisfies ClawSchedulerTick,
          {
            // Per-task de-dup within the due minute, and across replicas.
            singletonKey: `claw-task:${task.taskId}`,
            singletonSeconds: 60,
            // Deliberate, matching enqueueGatewayRun: a run that failed halfway may
            // already have sent mail or mutated external state, so replaying it
            // could duplicate side effects. Failures surface on the run record and
            // via failureStreak instead.
            retryLimit: 0,
            expireInMinutes: EXPIRE_IN_MINUTES,
          },
        );

        // Interval tasks stay "due" until their anchor moves, so advance it now —
        // otherwise the next sweep (30s away) enqueues again while this run is
        // still executing.
        if (task.scheduleType === 'interval' && task.intervalMinutes) {
          await advanceIntervalAnchor(task.taskId, task.intervalMinutes, nowMs);
        }
      } catch (error) {
        log.error('Failed to enqueue scheduled tick', {
          taskId: task.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.info('Enqueued due scheduled tick(s)', { due: due.length, active: active.length });
  } catch (error) {
    log.error('Sweep failed', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    sweepInFlight = false;
  }
}

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(CLAW_SCHEDULER_TICK_QUEUE, handleClawSchedulerTick);
  }

  await boss.createQueue(CLAW_SCHEDULER_TICK_QUEUE);

  // batchSize > 1 so independent tenants' tasks run concurrently rather than one
  // slow report blocking every other tenant's schedule.
  await boss.work(CLAW_SCHEDULER_TICK_QUEUE, { batchSize: 3 }, async (jobs) => {
    const results = await Promise.allSettled(
      jobs.map((job) => executor.execute(CLAW_SCHEDULER_TICK_QUEUE, job.data)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.error('Scheduled tick job failed', {
          jobId: jobs[index]?.id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  });

  await sweep(boss);
  sweepTimer = setInterval(() => {
    void sweep(boss);
  }, env.CLAW_SCHEDULER_SWEEP_MS);

  log.info('Registered scheduler sweeper', {
    queue: CLAW_SCHEDULER_TICK_QUEUE,
    sweepMs: env.CLAW_SCHEDULER_SWEEP_MS,
  });
}

/**
 * Stop scheduling new sweeps. Call at the START of shutdown, before boss.stop(),
 * so no tick is enqueued against a stopping boss while in-flight handlers drain.
 */
export function stopClawSchedulerSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
