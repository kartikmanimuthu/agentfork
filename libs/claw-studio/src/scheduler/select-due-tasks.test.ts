import { describe, expect, it } from 'vitest';
import { DUE_WINDOW_MS, selectDueTasks } from './select-due-tasks';
import type { ActiveTaskRow } from './types';

const row = (over: Partial<ActiveTaskRow> = {}): ActiveTaskRow => ({
  taskId: 't-1',
  tenantId: 'tenant-1',
  scheduleType: 'cron',
  cronExpression: '0 10 * * *',
  intervalMinutes: null,
  runAt: null,
  timezone: 'UTC',
  nextRunAt: null,
  ...over,
});

const at = (iso: string) => new Date(iso).getTime();

describe('selectDueTasks — cron', () => {
  it('selects a task 30s after its scheduled minute', () => {
    expect(selectDueTasks([row()], at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS)).toHaveLength(1);
  });

  it('does not select it two minutes later', () => {
    expect(selectDueTasks([row()], at('2026-07-30T10:02:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('does not select it before it fires', () => {
    expect(selectDueTasks([row()], at('2026-07-30T09:59:00Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('respects the task timezone', () => {
    const kolkata = row({ timezone: 'Asia/Kolkata' });
    // 10:00 IST is 04:30 UTC.
    expect(selectDueTasks([kolkata], at('2026-07-30T04:30:20Z'), DUE_WINDOW_MS)).toHaveLength(1);
    expect(selectDueTasks([kolkata], at('2026-07-30T10:00:20Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('skips a malformed cron expression without throwing', () => {
    const bad = [row({ cronExpression: 'not a cron' })];
    expect(() => selectDueTasks(bad, at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS)).not.toThrow();
    expect(selectDueTasks(bad, at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS)).toHaveLength(0);
  });

  it('skips an empty cron expression', () => {
    expect(selectDueTasks([row({ cronExpression: '' })], at('2026-07-30T10:00:30Z'), DUE_WINDOW_MS))
      .toHaveLength(0);
  });
});

describe('selectDueTasks — interval', () => {
  const iv = (over: Partial<ActiveTaskRow> = {}) =>
    row({ scheduleType: 'interval', cronExpression: '', intervalMinutes: 30, ...over });

  it('selects when the anchor has passed', () => {
    const due = selectDueTasks(
      [iv({ nextRunAt: new Date('2026-07-30T09:00:00Z') })],
      at('2026-07-30T10:00:00Z'),
      DUE_WINDOW_MS,
    );
    expect(due).toHaveLength(1);
  });

  it('does not select before the anchor', () => {
    const due = selectDueTasks(
      [iv({ nextRunAt: new Date('2026-07-30T11:00:00Z') })],
      at('2026-07-30T10:00:00Z'),
      DUE_WINDOW_MS,
    );
    expect(due).toHaveLength(0);
  });

  it('fires once when the anchor is null', () => {
    expect(selectDueTasks([iv({ nextRunAt: null })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS))
      .toHaveLength(1);
  });

  it('skips an interval task with a missing or non-positive intervalMinutes', () => {
    const now = at('2026-07-30T10:00:00Z');
    expect(selectDueTasks([iv({ intervalMinutes: null })], now, DUE_WINDOW_MS)).toHaveLength(0);
    expect(selectDueTasks([iv({ intervalMinutes: 0 })], now, DUE_WINDOW_MS)).toHaveLength(0);
    expect(selectDueTasks([iv({ intervalMinutes: -5 })], now, DUE_WINDOW_MS)).toHaveLength(0);
  });
});

describe('selectDueTasks — once', () => {
  const once = (over: Partial<ActiveTaskRow> = {}) =>
    row({ scheduleType: 'once', cronExpression: '', ...over });

  it('selects when runAt has passed', () => {
    const due = selectDueTasks(
      [once({ runAt: new Date('2026-07-30T09:00:00Z') })],
      at('2026-07-30T10:00:00Z'),
      DUE_WINDOW_MS,
    );
    expect(due).toHaveLength(1);
  });

  it('does not select before runAt', () => {
    const due = selectDueTasks(
      [once({ runAt: new Date('2026-07-30T11:00:00Z') })],
      at('2026-07-30T10:00:00Z'),
      DUE_WINDOW_MS,
    );
    expect(due).toHaveLength(0);
  });

  it('skips a once task with no runAt', () => {
    expect(selectDueTasks([once({ runAt: null })], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS))
      .toHaveLength(0);
  });
});

describe('selectDueTasks — mixed', () => {
  it('evaluates each task independently; one malformed row cannot hide a good one', () => {
    const tasks = [
      row({ taskId: 'good', cronExpression: '0 10 * * *' }),
      row({ taskId: 'bad', cronExpression: '!!!' }),
      row({ taskId: 'later', cronExpression: '0 23 * * *' }),
    ];
    const due = selectDueTasks(tasks, at('2026-07-30T10:00:10Z'), DUE_WINDOW_MS);
    expect(due.map((t) => t.taskId)).toEqual(['good']);
  });

  it('returns an empty array for no tasks', () => {
    expect(selectDueTasks([], at('2026-07-30T10:00:00Z'), DUE_WINDOW_MS)).toEqual([]);
  });

  it('uses a 60s due window, matching pg-boss timekeeping', () => {
    expect(DUE_WINDOW_MS).toBe(60_000);
  });
});
