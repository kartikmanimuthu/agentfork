import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredTool } from '@langchain/core/tools';
import { createScheduleTools } from './schedule-tools';
import { InvalidScheduleError, TaskLimitError } from './scheduled-task-service';

function fakeService() {
  const tasks: Array<Record<string, unknown>> = [];
  return {
    tasks,
    create: vi.fn(async (input: Record<string, unknown>) => {
      const task = { taskId: `task_${tasks.length + 1}`, status: 'active', ...input };
      tasks.push(task);
      return task;
    }),
    list: vi.fn(async () => tasks),
    get: vi.fn(async (taskId: string) => tasks.find((t) => t.taskId === taskId) ?? null),
    update: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
      const task = tasks.find((t) => t.taskId === taskId);
      if (!task) return null;
      Object.assign(task, patch);
      return task;
    }),
    remove: vi.fn(async (taskId: string) => {
      const index = tasks.findIndex((t) => t.taskId === taskId);
      if (index >= 0) tasks.splice(index, 1);
    }),
  };
}

const byName = (tools: StructuredTool[], name: string) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
};

describe('createScheduleTools', () => {
  let svc: ReturnType<typeof fakeService>;
  let tools: StructuredTool[];

  beforeEach(() => {
    svc = fakeService();
    tools = createScheduleTools('t1', { service: svc as never });
  });

  it('exposes the four scheduling tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_scheduled_task',
      'delete_scheduled_task',
      'list_scheduled_tasks',
      'update_scheduled_task',
    ]);
  });

  it('creates a task and confirms it in plain language', async () => {
    const out = await byName(tools, 'create_scheduled_task').invoke({
      name: 'Daily report',
      prompt: 'Every run, summarise the board.',
      cronExpression: '0 10 * * *',
      timezone: 'Asia/Kolkata',
    });
    expect(out).toMatch(/created/i);
    expect(out).toContain('Daily report');
    expect(svc.create).toHaveBeenCalledOnce();
  });

  it('passes delivery through when given', async () => {
    await byName(tools, 'create_scheduled_task').invoke({
      name: 'Report',
      prompt: 'Do it.',
      cronExpression: '0 10 * * *',
      deliveryType: 'email',
      deliveryTarget: 'me@example.com',
    });
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: { type: 'email', target: 'me@example.com' } }),
    );
  });

  it('selects allowlist mode when tools are granted', async () => {
    await byName(tools, 'create_scheduled_task').invoke({
      name: 'Report',
      prompt: 'Do it.',
      cronExpression: '0 10 * * *',
      allowedTools: ['gmail_send_message'],
    });
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ approvalMode: 'allowlist', allowedTools: ['gmail_send_message'] }),
    );
  });

  it('returns the validation message rather than throwing on a bad cadence', async () => {
    svc.create.mockRejectedValueOnce(new InvalidScheduleError('runs every minute; minimum is 15'));
    const out = await byName(tools, 'create_scheduled_task').invoke({
      name: 'Too frequent',
      prompt: 'Do it.',
      cronExpression: '* * * * *',
    });
    expect(out).toMatch(/every minute/i);
    expect(out).not.toMatch(/^Error:/);
  });

  it('returns a readable message when the tenant is at its task cap', async () => {
    svc.create.mockRejectedValueOnce(new TaskLimitError(25));
    const out = await byName(tools, 'create_scheduled_task').invoke({
      name: 'One too many',
      prompt: 'Do it.',
      cronExpression: '0 10 * * *',
    });
    expect(out).toMatch(/25 active/i);
  });

  it('lists tasks with cadence and next run', async () => {
    svc.tasks.push({
      taskId: 'task_x', name: 'Nightly', scheduleType: 'cron', cronExpression: '0 2 * * *',
      timezone: 'UTC', status: 'active', nextRunAt: new Date('2026-08-01T02:00:00Z'),
    });
    const out = await byName(tools, 'list_scheduled_tasks').invoke({});
    expect(out).toContain('Nightly');
    expect(out).toContain('0 2 * * *');
  });

  it('says so plainly when there are no tasks', async () => {
    expect(await byName(tools, 'list_scheduled_tasks').invoke({})).toMatch(/no scheduled tasks/i);
  });

  it('pauses a task through update', async () => {
    svc.tasks.push({ taskId: 'task_y', name: 'Thing', status: 'active' });
    const out = await byName(tools, 'update_scheduled_task').invoke({ taskId: 'task_y', status: 'paused' });
    expect(out).toMatch(/paused/i);
    expect(svc.tasks[0].status).toBe('paused');
  });

  it('reports a missing task on update instead of throwing', async () => {
    const out = await byName(tools, 'update_scheduled_task').invoke({ taskId: 'nope', status: 'paused' });
    expect(out).toMatch(/no scheduled task/i);
  });

  it('deletes a task', async () => {
    svc.tasks.push({ taskId: 'task_z', name: 'Gone', status: 'active' });
    const out = await byName(tools, 'delete_scheduled_task').invoke({ taskId: 'task_z' });
    expect(out).toMatch(/deleted/i);
    expect(svc.tasks).toHaveLength(0);
  });

  it('reports a missing task on delete instead of throwing', async () => {
    const out = await byName(tools, 'delete_scheduled_task').invoke({ taskId: 'nope' });
    expect(out).toMatch(/no scheduled task/i);
  });
});
