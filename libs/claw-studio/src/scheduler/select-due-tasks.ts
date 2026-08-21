/**
 * select-due-tasks.ts — which active tasks are due right now.
 *
 * Ported from nucleus `apps/workers/src/jobs/agent-ops-scheduler/index.ts`.
 * Deliberately pure: no DB, no queue, no clock (`nowMs` is injected). That is what
 * makes timezone handling, malformed crons, and the due window exhaustively
 * testable in milliseconds instead of needing Postgres and pg-boss stood up.
 */

import { Cron } from 'croner';
import { createLogger } from '@chatbot/shared';
import type { ActiveTaskRow } from './types';

const logger = createLogger('claw-studio:scheduler:select');

/**
 * A task counts as due if its most recent scheduled occurrence falls inside this
 * window. Mirrors pg-boss's own timekeeper (`prevDiff < 60`) and pairs with
 * `singletonSeconds: 60` on the enqueue, so the two 30s sweeps that land inside one
 * due-minute collapse into a single tick.
 */
export const DUE_WINDOW_MS = 60_000;

function cronDue(task: ActiveTaskRow, nowMs: number, windowMs: number): boolean {
  if (!task.cronExpression.trim()) return false;
  try {
    const cron = new Cron(task.cronExpression, { timezone: task.timezone });
    // previousRuns(1, ref), not previousRun(ref): the latter reports the last time
    // a *live scheduled job* actually fired and is null for an unscheduled Cron
    // instance like this one. Same call nucleus uses.
    const prev = cron.previousRuns(1, new Date(nowMs))[0];
    return !!prev && nowMs - prev.getTime() < windowMs;
  } catch (error) {
    logger.warn(
      {
        taskId: task.taskId,
        cronExpression: task.cronExpression,
        error: error instanceof Error ? error.message : String(error),
      },
      'Invalid cron expression — skipping task',
    );
    return false;
  }
}

/**
 * Never throws: one malformed row must not stop every other tenant's schedule.
 */
export function selectDueTasks(
  tasks: ActiveTaskRow[],
  nowMs: number,
  windowMs: number,
): ActiveTaskRow[] {
  return tasks.filter((task) => {
    if (task.scheduleType === 'interval') {
      if (!task.intervalMinutes || task.intervalMinutes <= 0) {
        logger.warn({ taskId: task.taskId }, 'Interval task without a positive intervalMinutes — skipping');
        return false;
      }
      // A null anchor (just switched to interval) fires once, then advances.
      return task.nextRunAt === null || task.nextRunAt.getTime() <= nowMs;
    }
    if (task.scheduleType === 'once') {
      return task.runAt !== null && task.runAt.getTime() <= nowMs;
    }
    return cronDue(task, nowMs, windowMs);
  });
}
