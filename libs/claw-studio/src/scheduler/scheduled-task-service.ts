/**
 * scheduled-task-service.ts — CRUD and guards for scheduled tasks.
 *
 * Ported from nucleus `apps/web-ui/lib/agent-ops/scheduled-task-service.ts`, with a
 * cadence floor added: nucleus validated the interval floor but not the effective
 * frequency of a cron expression, so `* * * * *` slipped through.
 */

import crypto from 'crypto';
import { Cron } from 'croner';
import type { PrismaClient } from '@prisma/client';
import { createLogger, getPrismaClient, AuditService } from '@chatbot/shared';
import { env } from '../env';
import type {
  ApprovalMode, ScheduleType, ScheduledTaskRecord, SessionMode, TaskDelivery, ActiveTaskRow,
} from './types';

const logger = createLogger('claw-studio:scheduler:service');

/** Consecutive failures before a task pauses itself. */
export const FAILURE_STREAK_LIMIT = 3;

/** Locks expire so a crashed worker cannot wedge a task forever. */
const LOCK_TTL_MS = 60 * 60 * 1000;

export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScheduleError';
  }
}

export class TaskLimitError extends Error {
  constructor(limit: number) {
    super(`This tenant already has ${limit} active scheduled tasks. Pause or delete one first.`);
    this.name = 'TaskLimitError';
  }
}

export class ClawNotProvisionedError extends Error {
  constructor() {
    super('No Claw provisioned for this tenant');
    this.name = 'ClawNotProvisionedError';
  }
}

export function generateTaskId(): string {
  return `task_${crypto.randomBytes(14).toString('base64url')}`;
}

export interface ScheduleInput {
  scheduleType?: string;
  cronExpression?: string;
  intervalMinutes?: unknown;
  runAt?: unknown;
  timezone?: string;
}

/** Returns an error message for a 400 response, or null when the schedule is valid. */
export function validateSchedule(input: ScheduleInput): string | null {
  const scheduleType = input.scheduleType ?? 'cron';
  const floor = env.CLAW_MIN_INTERVAL_MINUTES;

  if (scheduleType === 'interval') {
    const minutes = Number(input.intervalMinutes);
    if (!Number.isInteger(minutes) || minutes < floor) {
      return `intervalMinutes must be a whole number of at least ${floor}.`;
    }
    return null;
  }

  if (scheduleType === 'once') {
    const at = new Date(String(input.runAt ?? ''));
    if (Number.isNaN(at.getTime())) return 'runAt must be a valid date/time.';
    return null;
  }

  if (scheduleType !== 'cron') {
    return "scheduleType must be one of 'cron', 'interval', or 'once'.";
  }

  const expression = (input.cronExpression ?? '').trim();
  if (!expression) return 'cronExpression is required for cron schedules.';

  let cron: Cron;
  try {
    cron = new Cron(expression, { timezone: input.timezone ?? 'UTC' });
  } catch {
    return `"${expression}" is not a valid cron expression.`;
  }

  // Cadence floor: compare the first two occurrences. nucleus never checked this,
  // so "* * * * *" was accepted and would wake the agent every minute.
  const upcoming = cron.nextRuns(2);
  if (upcoming.length < 2) return `"${expression}" is not a valid cron expression.`;
  const gapMinutes = Math.round((upcoming[1].getTime() - upcoming[0].getTime()) / 60_000);
  if (gapMinutes < floor) {
    const every = gapMinutes === 1 ? 'every minute' : `every ${gapMinutes} minutes`;
    return `That schedule runs ${every}; runs must be at least ${floor} minutes apart.`;
  }
  return null;
}

export function computeNextRunAt(
  task: Pick<ActiveTaskRow, 'scheduleType' | 'cronExpression' | 'timezone' | 'intervalMinutes' | 'runAt'>,
  fromMs: number,
): Date | null {
  try {
    if (task.scheduleType === 'interval') {
      if (!task.intervalMinutes || task.intervalMinutes <= 0) return null;
      return new Date(fromMs + task.intervalMinutes * 60_000);
    }
    // A one-off does not recur, so it has no "next" beyond its own runAt.
    if (task.scheduleType === 'once') return null;
    if (!task.cronExpression.trim()) return null;
    return new Cron(task.cronExpression, { timezone: task.timezone }).nextRun(new Date(fromMs));
  } catch {
    return null;
  }
}

export interface CreateTaskInput {
  name: string;
  prompt: string;
  scheduleType?: ScheduleType;
  cronExpression?: string;
  intervalMinutes?: number | null;
  runAt?: Date | string | null;
  timezone?: string;
  approvalMode?: ApprovalMode;
  allowedTools?: string[];
  sessionMode?: SessionMode;
  maxIterations?: number | null;
  providerModelId?: string | null;
  delivery?: TaskDelivery;
  createdBy?: string | null;
}

export type UpdateTaskInput = Partial<CreateTaskInput> & { status?: ScheduledTaskRecord['status'] };

function toRecord(row: Record<string, unknown>): ScheduledTaskRecord {
  return {
    ...row,
    delivery: (row.delivery ?? {}) as TaskDelivery,
    allowedTools: (row.allowedTools ?? []) as string[],
  } as ScheduledTaskRecord;
}

export class ScheduledTaskService {
  private readonly db: PrismaClient;

  constructor(private readonly tenantId: string, db?: PrismaClient) {
    this.db = db ?? getPrismaClient();
  }

  async create(input: CreateTaskInput): Promise<ScheduledTaskRecord> {
    const scheduleType = input.scheduleType ?? 'cron';
    const timezone = input.timezone ?? 'UTC';
    const invalid = validateSchedule({
      scheduleType,
      cronExpression: input.cronExpression,
      intervalMinutes: input.intervalMinutes,
      runAt: input.runAt,
      timezone,
    });
    if (invalid) throw new InvalidScheduleError(invalid);

    try {
      const active = await this.db.clawScheduledTask.count({
        where: { tenantId: this.tenantId, status: 'active' },
      });
      if (active >= env.CLAW_MAX_ACTIVE_TASKS_PER_TENANT) {
        throw new TaskLimitError(env.CLAW_MAX_ACTIVE_TASKS_PER_TENANT);
      }

      const studio = await this.db.clawStudio.findFirst({
        where: { tenantId: this.tenantId },
        include: { claws: true },
      });
      const clawId = studio?.claws[0]?.id;
      if (!clawId) throw new ClawNotProvisionedError();

      const runAt = input.runAt ? new Date(input.runAt) : null;
      const taskId = generateTaskId();
      const nextRunAt = computeNextRunAt(
        {
          scheduleType,
          cronExpression: input.cronExpression ?? '',
          timezone,
          intervalMinutes: input.intervalMinutes ?? null,
          runAt,
        },
        Date.now(),
      ) ?? runAt;

      const row = await this.db.clawScheduledTask.create({
        data: {
          tenantId: this.tenantId,
          clawId,
          taskId,
          name: input.name,
          prompt: input.prompt,
          scheduleType,
          cronExpression: input.cronExpression ?? '',
          intervalMinutes: input.intervalMinutes ?? null,
          runAt,
          timezone,
          status: 'active',
          approvalMode: input.approvalMode ?? 'ask',
          allowedTools: input.allowedTools ?? [],
          sessionMode: input.sessionMode ?? 'isolated',
          maxIterations: input.maxIterations ?? null,
          providerModelId: input.providerModelId ?? null,
          delivery: (input.delivery ?? { type: 'none' }) as object,
          nextRunAt,
          createdBy: input.createdBy ?? null,
        },
      });
      logger.info({ tenantId: this.tenantId, taskId, scheduleType }, 'Scheduled task created');
      return toRecord(row as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof TaskLimitError || error instanceof ClawNotProvisionedError) throw error;
      logger.error({ error, tenantId: this.tenantId }, 'Failed to create scheduled task');
      throw error;
    }
  }

  async get(taskId: string): Promise<ScheduledTaskRecord | null> {
    try {
      const row = await this.db.clawScheduledTask.findFirst({
        where: { tenantId: this.tenantId, taskId },
      });
      return row ? toRecord(row as unknown as Record<string, unknown>) : null;
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, taskId }, 'Failed to read scheduled task');
      throw error;
    }
  }

  async list(): Promise<ScheduledTaskRecord[]> {
    try {
      const rows = await this.db.clawScheduledTask.findMany({
        where: { tenantId: this.tenantId, status: { not: 'deleted' } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId }, 'Failed to list scheduled tasks');
      throw error;
    }
  }

  async update(taskId: string, patch: UpdateTaskInput): Promise<ScheduledTaskRecord | null> {
    const existing = await this.get(taskId);
    if (!existing) return null;

    const scheduleTouched =
      patch.scheduleType !== undefined
      || patch.cronExpression !== undefined
      || patch.intervalMinutes !== undefined
      || patch.runAt !== undefined
      || patch.timezone !== undefined;

    const scheduleType = patch.scheduleType ?? existing.scheduleType;
    const timezone = patch.timezone ?? existing.timezone;
    const cronExpression = patch.cronExpression ?? existing.cronExpression;
    const intervalMinutes = patch.intervalMinutes ?? existing.intervalMinutes;
    const runAt = patch.runAt !== undefined
      ? (patch.runAt ? new Date(patch.runAt) : null)
      : existing.runAt;

    if (scheduleTouched) {
      const invalid = validateSchedule({ scheduleType, cronExpression, intervalMinutes, runAt, timezone });
      if (invalid) throw new InvalidScheduleError(invalid);
    }

    // Resuming a paused task must re-anchor it, or an interval task would fire
    // immediately on a stale nextRunAt.
    const resuming = patch.status === 'active' && existing.status !== 'active';
    const nextRunAt = scheduleTouched || resuming
      ? computeNextRunAt({ scheduleType, cronExpression, timezone, intervalMinutes, runAt }, Date.now()) ?? runAt
      : undefined;

    try {
      const row = await this.db.clawScheduledTask.update({
        where: { taskId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.approvalMode !== undefined ? { approvalMode: patch.approvalMode } : {}),
          ...(patch.allowedTools !== undefined ? { allowedTools: patch.allowedTools } : {}),
          ...(patch.sessionMode !== undefined ? { sessionMode: patch.sessionMode } : {}),
          ...(patch.maxIterations !== undefined ? { maxIterations: patch.maxIterations } : {}),
          ...(patch.providerModelId !== undefined ? { providerModelId: patch.providerModelId } : {}),
          ...(patch.delivery !== undefined ? { delivery: patch.delivery as object } : {}),
          ...(scheduleTouched
            ? { scheduleType, cronExpression, intervalMinutes, runAt, timezone }
            : {}),
          ...(nextRunAt !== undefined ? { nextRunAt } : {}),
        },
      });
      logger.info({ tenantId: this.tenantId, taskId }, 'Scheduled task updated');
      return toRecord(row as unknown as Record<string, unknown>);
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, taskId }, 'Failed to update scheduled task');
      throw error;
    }
  }

  /** Soft delete — run history references the taskId, so the row stays. */
  async remove(taskId: string): Promise<void> {
    try {
      await this.db.clawScheduledTask.update({
        where: { taskId },
        data: { status: 'deleted', nextRunAt: null },
      });
      logger.info({ tenantId: this.tenantId, taskId }, 'Scheduled task deleted');
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, taskId }, 'Failed to delete scheduled task');
      throw error;
    }
  }

  /**
   * Appends a tool to the task's allowlist, deduped. Backs "always allow for this task".
   * `sourceRunId` records which run's approval triggered the grant — otherwise a standing
   * permission has no provenance beyond Pino logs, which rotate.
   */
  async grantTool(taskId: string, toolName: string, sourceRunId?: string): Promise<void> {
    const task = await this.get(taskId);
    if (!task) return;
    if (task.allowedTools.includes(toolName)) return;
    try {
      await this.db.clawScheduledTask.update({
        where: { taskId },
        data: { allowedTools: [...task.allowedTools, toolName] },
      });
      logger.info({ tenantId: this.tenantId, taskId, toolName }, 'Granted tool to scheduled task');
      await AuditService.logSystemEvent({
        eventType: 'schedule.tool_granted',
        action: 'Granted Tool to Scheduled Task',
        status: 'success',
        details: `"${toolName}" granted to scheduled task "${task.name}" (always-allow, from a run's approval)`,
        resourceType: 'scheduled_task',
        resourceId: taskId,
        tenantId: this.tenantId,
        metadata: { tenantId: this.tenantId, taskId, toolName, sourceRunId },
      }).catch((error) => logger.warn({ error, tenantId: this.tenantId, taskId, toolName }, 'Failed to audit-log tool grant'));
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, taskId, toolName }, 'Failed to grant tool');
      throw error;
    }
  }

  /**
   * Post-run bookkeeping. Returns whether the task paused itself, so the caller can
   * tell the user rather than letting it go quiet.
   */
  async recordRun(taskId: string, runId: string, status: string): Promise<{ autoPaused: boolean }> {
    const task = await this.get(taskId);
    if (!task) return { autoPaused: false };

    const failed = status === 'failed' || status === 'cancelled';
    const failureStreak = failed ? task.failureStreak + 1 : 0;
    const autoPaused = failed && failureStreak >= FAILURE_STREAK_LIMIT;

    const nextRunAt = computeNextRunAt(
      {
        scheduleType: task.scheduleType,
        cronExpression: task.cronExpression,
        timezone: task.timezone,
        intervalMinutes: task.intervalMinutes,
        runAt: task.runAt,
      },
      Date.now(),
    );

    try {
      await this.db.clawScheduledTask.update({
        where: { taskId },
        data: {
          lastRunId: runId,
          lastRunAt: new Date(),
          lastRunStatus: status,
          runCount: { increment: 1 },
          failureStreak,
          nextRunAt: autoPaused ? null : nextRunAt,
          ...(autoPaused ? { status: 'paused' } : {}),
        },
      });
      if (autoPaused) {
        logger.warn(
          { tenantId: this.tenantId, taskId, failureStreak },
          'Scheduled task auto-paused after consecutive failures',
        );
      }
      return { autoPaused };
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, taskId }, 'Failed to record scheduled run');
      throw error;
    }
  }
}

// ─── Tenant-agnostic helpers used by the worker ──────────────────────────────

export async function listAllActiveTasks(db?: PrismaClient): Promise<ActiveTaskRow[]> {
  const client = db ?? getPrismaClient();
  const rows = await client.clawScheduledTask.findMany({
    where: { status: 'active' },
    select: {
      taskId: true, tenantId: true, scheduleType: true, cronExpression: true,
      intervalMinutes: true, runAt: true, timezone: true, nextRunAt: true,
    },
  });
  return rows as ActiveTaskRow[];
}

/**
 * Pushes an interval task's anchor forward so the next sweep does not re-fire it
 * while the current run is still executing. Racing sweeps are harmless: the enqueue
 * is deduped by singletonKey and both racers write approximately the same anchor.
 */
export async function advanceIntervalAnchor(
  taskId: string,
  intervalMinutes: number,
  nowMs: number,
  db?: PrismaClient,
): Promise<void> {
  const client = db ?? getPrismaClient();
  await client.clawScheduledTask.updateMany({
    where: { taskId },
    data: { nextRunAt: new Date(nowMs + intervalMinutes * 60_000) },
  });
}

/**
 * Atomic across replicas: the unique index on (taskId, scheduledAt) means the loser
 * of a race gets P2002 and simply does not run.
 */
export async function tryAcquireLock(
  taskId: string,
  scheduledAt: string,
  db?: PrismaClient,
): Promise<boolean> {
  const client = db ?? getPrismaClient();
  try {
    await client.clawScheduledTaskLock.create({
      data: { taskId, scheduledAt, expiresAt: new Date(Date.now() + LOCK_TTL_MS) },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return false;
    logger.error({ error, taskId, scheduledAt }, 'Failed to acquire scheduled task lock');
    throw error;
  }
}

/** A one-off is spent once it has fired. */
export async function completeOnceTask(taskId: string, db?: PrismaClient): Promise<void> {
  const client = db ?? getPrismaClient();
  await client.clawScheduledTask.updateMany({
    where: { taskId },
    data: { status: 'completed', nextRunAt: null },
  });
}
