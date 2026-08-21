/**
 * schedule-tools.ts — lets Claw schedule its own work from chat.
 *
 * This is what makes scheduling feel alive: "email me a Jira report every day at
 * 10am" creates the task, instead of pointing at a settings page.
 *
 * `create_scheduled_task` matches /\bcreate\b/i in tool-classifier.ts, so it is
 * approval-gated automatically — the user confirms before a recurring job exists.
 *
 * As with file-tools, these never throw: a thrown LangChain tool error aborts the
 * whole run, so validation failures come back as text the model can act on.
 */

import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import {
  InvalidScheduleError, ScheduledTaskService, TaskLimitError,
} from './scheduled-task-service';
import type { DeliveryChannel, ScheduledTaskRecord } from './types';

const logger = createLogger('claw-studio:scheduler:tools');

const DELIVERY_CHANNELS = ['slack', 'telegram', 'discord', 'jira', 'email', 'none'] as const;

export interface ScheduleToolsOptions {
  service?: ScheduledTaskService;
}

function describeCadence(task: Pick<ScheduledTaskRecord, 'scheduleType' | 'cronExpression' | 'intervalMinutes' | 'runAt'>): string {
  if (task.scheduleType === 'interval') return `every ${task.intervalMinutes} minutes`;
  if (task.scheduleType === 'once') return `once at ${task.runAt?.toISOString() ?? 'an unset time'}`;
  return `cron ${task.cronExpression}`;
}

/** Turns a service error into something the model can actually respond to. */
function explain(error: unknown, action: string): string {
  if (error instanceof InvalidScheduleError) return `That schedule is not valid: ${error.message}`;
  if (error instanceof TaskLimitError) return error.message;
  return `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`;
}

export function createScheduleTools(
  tenantId: string,
  options: ScheduleToolsOptions = {},
): StructuredTool[] {
  const svc = options.service ?? new ScheduledTaskService(tenantId);

  const create_scheduled_task = tool(
    async ({ name, prompt, cronExpression, timezone, deliveryType, deliveryTarget, allowedTools }: {
      name: string;
      prompt: string;
      cronExpression: string;
      timezone?: string;
      deliveryType?: DeliveryChannel;
      deliveryTarget?: string;
      allowedTools?: string[];
    }) => {
      try {
        const granted = allowedTools ?? [];
        const task = await svc.create({
          name,
          prompt,
          scheduleType: 'cron',
          cronExpression,
          timezone: timezone ?? 'UTC',
          // Granting tools implies allowlist mode; without grants keep the safe
          // default so the run pauses for anything that changes state.
          approvalMode: granted.length > 0 ? 'allowlist' : 'ask',
          allowedTools: granted,
          delivery: {
            type: deliveryType ?? 'none',
            ...(deliveryTarget ? { target: deliveryTarget } : {}),
          },
        });
        logger.info({ tenantId, taskId: task.taskId }, 'Claw created a scheduled task');
        return `Created "${task.name}" (${describeCadence(task)}, ${task.timezone}). Next run: ${task.nextRunAt?.toISOString() ?? 'not scheduled'}. Task id: ${task.taskId}`;
      } catch (error) {
        logger.warn({ error, tenantId, name }, 'create_scheduled_task failed');
        return explain(error, 'create that scheduled task');
      }
    },
    {
      name: 'create_scheduled_task',
      description: [
        'Create a recurring task you will run on a schedule, unattended.',
        'Write `prompt` as a STANDALONE instruction: it runs with fresh context and',
        'nobody is available to answer questions. Keep concrete identifiers verbatim,',
        'express any time window relative to run time ("in the trailing 24 hours"),',
        'never refer to this conversation, and state what to report when there is',
        'nothing to report. Pass allowedTools for the state-changing tools the task',
        'genuinely needs, or it will pause on them and wait for a human.',
      ].join(' '),
      schema: z.object({
        name: z.string().describe('Short name, e.g. "Daily Jira Report"'),
        prompt: z.string().describe('The standalone instruction to run each time'),
        cronExpression: z.string().describe('5-field cron, e.g. "0 10 * * *" for 10am daily'),
        timezone: z.string().optional().describe('IANA timezone, e.g. Asia/Kolkata. Defaults to UTC'),
        deliveryType: z.enum(DELIVERY_CHANNELS).optional().describe('Where to send the result'),
        deliveryTarget: z.string().optional().describe('Channel, chat id, issue key, or email address'),
        allowedTools: z.array(z.string()).optional()
          .describe('Exact tool names this task may use unattended, e.g. ["gmail_send_message"]'),
      }),
    },
  );

  const list_scheduled_tasks = tool(
    async () => {
      try {
        const tasks = await svc.list();
        if (!tasks.length) return 'There are no scheduled tasks.';
        return tasks
          .map((task) => [
            `${task.name} [${task.taskId}]`,
            `  ${describeCadence(task)} (${task.timezone}) · ${task.status}`,
            `  next: ${task.nextRunAt?.toISOString() ?? '—'} · runs: ${task.runCount}`,
          ].join('\n'))
          .join('\n');
      } catch (error) {
        logger.error({ error, tenantId }, 'list_scheduled_tasks failed');
        return explain(error, 'list scheduled tasks');
      }
    },
    {
      name: 'list_scheduled_tasks',
      description: 'List the recurring tasks you already run on a schedule, with their cadence and next run.',
      schema: z.object({}),
    },
  );

  const update_scheduled_task = tool(
    async ({ taskId, name, prompt, cronExpression, timezone, status }: {
      taskId: string;
      name?: string;
      prompt?: string;
      cronExpression?: string;
      timezone?: string;
      status?: 'active' | 'paused';
    }) => {
      try {
        const task = await svc.update(taskId, {
          ...(name !== undefined ? { name } : {}),
          ...(prompt !== undefined ? { prompt } : {}),
          ...(cronExpression !== undefined ? { cronExpression } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        if (!task) return `There is no scheduled task with id "${taskId}".`;
        const verb = status === 'paused' ? 'Paused' : status === 'active' ? 'Resumed' : 'Updated';
        return `${verb} "${task.name}" (${describeCadence(task)}, ${task.timezone}).`;
      } catch (error) {
        logger.warn({ error, tenantId, taskId }, 'update_scheduled_task failed');
        return explain(error, 'update that scheduled task');
      }
    },
    {
      name: 'update_scheduled_task',
      description: 'Change a scheduled task, or pause/resume it. Pass only the fields you want to change.',
      schema: z.object({
        taskId: z.string().describe('The task id from list_scheduled_tasks'),
        name: z.string().optional(),
        prompt: z.string().optional(),
        cronExpression: z.string().optional(),
        timezone: z.string().optional(),
        status: z.enum(['active', 'paused']).optional().describe('paused stops it running'),
      }),
    },
  );

  const delete_scheduled_task = tool(
    async ({ taskId }: { taskId: string }) => {
      try {
        const task = await svc.get(taskId);
        if (!task) return `There is no scheduled task with id "${taskId}".`;
        await svc.remove(taskId);
        logger.info({ tenantId, taskId }, 'Claw deleted a scheduled task');
        return `Deleted "${task.name}". It will not run again.`;
      } catch (error) {
        logger.warn({ error, tenantId, taskId }, 'delete_scheduled_task failed');
        return explain(error, 'delete that scheduled task');
      }
    },
    {
      name: 'delete_scheduled_task',
      description: 'Stop a scheduled task permanently. Prefer pausing via update_scheduled_task if the user may want it back.',
      schema: z.object({ taskId: z.string().describe('The task id from list_scheduled_tasks') }),
    },
  );

  return [create_scheduled_task, list_scheduled_tasks, update_scheduled_task, delete_scheduled_task];
}
