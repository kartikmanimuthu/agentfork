import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAILURE_STREAK_LIMIT, InvalidScheduleError, ScheduledTaskService, TaskLimitError,
  computeNextRunAt, generateTaskId, validateSchedule,
} from './scheduled-task-service';

describe('generateTaskId', () => {
  it('produces unguessable prefixed ids', () => {
    const a = generateTaskId();
    expect(a).toMatch(/^task_[A-Za-z0-9_-]{16,}$/);
    expect(a).not.toBe(generateTaskId());
  });
});

describe('validateSchedule', () => {
  it('accepts a valid cron', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: '0 10 * * *' })).toBeNull();
  });

  it('rejects a missing cron expression', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: '  ' })).toMatch(/required/i);
  });

  it('rejects a malformed cron expression', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: 'nope' })).toMatch(/not a valid cron/i);
  });

  it('rejects a cron that fires more often than the floor', () => {
    expect(validateSchedule({ scheduleType: 'cron', cronExpression: '* * * * *' })).toMatch(/at least/i);
  });

  it('enforces the interval floor', () => {
    expect(validateSchedule({ scheduleType: 'interval', intervalMinutes: 5 })).toMatch(/at least/i);
    expect(validateSchedule({ scheduleType: 'interval', intervalMinutes: 15 })).toBeNull();
  });

  it('requires a valid future runAt for once', () => {
    expect(validateSchedule({ scheduleType: 'once', runAt: 'not a date' })).toMatch(/valid/i);
    expect(validateSchedule({
      scheduleType: 'once',
      runAt: new Date(Date.now() + 3_600_000).toISOString(),
    })).toBeNull();
  });

  it('rejects an unknown schedule type', () => {
    expect(validateSchedule({ scheduleType: 'weekly' })).toMatch(/cron|interval|once/i);
  });
});

describe('computeNextRunAt', () => {
  const base = { cronExpression: '0 10 * * *', timezone: 'UTC', intervalMinutes: null, runAt: null };

  it('returns the next cron occurrence', () => {
    const next = computeNextRunAt(
      { ...base, scheduleType: 'cron' },
      new Date('2026-07-30T10:30:00Z').getTime(),
    );
    expect(next?.toISOString()).toBe('2026-07-31T10:00:00.000Z');
  });

  it('returns now + interval for interval tasks', () => {
    const next = computeNextRunAt(
      { ...base, scheduleType: 'interval', intervalMinutes: 30 },
      new Date('2026-07-30T10:00:00Z').getTime(),
    );
    expect(next?.toISOString()).toBe('2026-07-30T10:30:00.000Z');
  });

  it('returns null for a once task — it does not recur', () => {
    expect(computeNextRunAt({ ...base, scheduleType: 'once', runAt: new Date() }, Date.now())).toBeNull();
  });

  it('returns null for an unparseable cron rather than throwing', () => {
    expect(computeNextRunAt({ ...base, scheduleType: 'cron', cronExpression: '!!' }, Date.now())).toBeNull();
  });
});

interface Row { [k: string]: unknown }

function makeDb(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  const clawScheduledTask = {
    count: vi.fn(async () => rows.filter((r) => r.status === 'active').length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { runCount: 0, failureStreak: 0, ...data };
      rows.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: { taskId: string } }) =>
      rows.find((r) => r.taskId === where.taskId) ?? null),
    findMany: vi.fn(async () => rows),
    update: vi.fn(async ({ where, data }: { where: { taskId: string }; data: Row }) => {
      const row = rows.find((r) => r.taskId === where.taskId)!;
      for (const [k, v] of Object.entries(data)) {
        row[k] = v && typeof v === 'object' && 'increment' in (v as Row)
          ? (row[k] as number) + ((v as { increment: number }).increment)
          : v;
      }
      return row;
    }),
  };
  const clawStudio = { findFirst: vi.fn(async () => ({ id: 's1', claws: [{ id: 'c1' }] })) };
  return { db: { clawScheduledTask, clawStudio } as never, rows };
}

describe('ScheduledTaskService', () => {
  let harness: ReturnType<typeof makeDb>;
  let svc: ScheduledTaskService;

  const valid = {
    name: 'Daily report',
    prompt: 'Every run, summarise the board.',
    scheduleType: 'cron' as const,
    cronExpression: '0 10 * * *',
    timezone: 'UTC',
  };

  beforeEach(() => {
    harness = makeDb();
    svc = new ScheduledTaskService('t1', harness.db);
  });

  it('creates a task with a generated id and a computed nextRunAt', async () => {
    const task = await svc.create(valid);
    expect(task.taskId).toMatch(/^task_/);
    expect(task.nextRunAt).toBeInstanceOf(Date);
    expect(task.status).toBe('active');
  });

  it('rejects an invalid schedule', async () => {
    await expect(svc.create({ ...valid, cronExpression: '* * * * *' }))
      .rejects.toThrow(InvalidScheduleError);
  });

  it('enforces the per-tenant active task cap', async () => {
    (harness.db as unknown as { clawScheduledTask: { count: ReturnType<typeof vi.fn> } })
      .clawScheduledTask.count.mockResolvedValueOnce(25);
    await expect(svc.create(valid)).rejects.toThrow(TaskLimitError);
  });

  it('appends a granted tool without duplicating', async () => {
    const task = await svc.create({ ...valid, allowedTools: ['gmail_send_message'] });
    await svc.grantTool(task.taskId, 'notion_create_page');
    await svc.grantTool(task.taskId, 'notion_create_page');
    expect((await svc.get(task.taskId))?.allowedTools)
      .toEqual(['gmail_send_message', 'notion_create_page']);
  });

  it('increments runCount and resets failureStreak on success', async () => {
    const task = await svc.create(valid);
    await svc.recordRun(task.taskId, 'run-1', 'failed');
    const result = await svc.recordRun(task.taskId, 'run-2', 'completed');
    const updated = await svc.get(task.taskId);
    expect(updated?.failureStreak).toBe(0);
    expect(updated?.runCount).toBe(2);
    expect(result.autoPaused).toBe(false);
  });

  it('auto-pauses after consecutive failures', async () => {
    const task = await svc.create(valid);
    let last = { autoPaused: false };
    for (let i = 0; i < FAILURE_STREAK_LIMIT; i++) {
      last = await svc.recordRun(task.taskId, `run-${i}`, 'failed');
    }
    expect(last.autoPaused).toBe(true);
    expect((await svc.get(task.taskId))?.status).toBe('paused');
  });

  it('records lastRun fields', async () => {
    const task = await svc.create(valid);
    await svc.recordRun(task.taskId, 'run-x', 'completed');
    const updated = await svc.get(task.taskId);
    expect(updated?.lastRunId).toBe('run-x');
    expect(updated?.lastRunStatus).toBe('completed');
    expect(updated?.lastRunAt).toBeInstanceOf(Date);
  });
});
