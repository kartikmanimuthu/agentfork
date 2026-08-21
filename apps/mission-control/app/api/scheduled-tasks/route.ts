import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { InvalidScheduleError, ScheduledTaskService, TaskLimitError } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:scheduled-tasks');

const deliverySchema = z.object({
  type: z.enum(['slack', 'telegram', 'discord', 'jira', 'email', 'none']),
  target: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  scheduleType: z.enum(['cron', 'interval', 'once']).default('cron'),
  cronExpression: z.string().optional(),
  intervalMinutes: z.number().int().positive().nullable().optional(),
  runAt: z.string().nullable().optional(),
  timezone: z.string().default('UTC'),
  approvalMode: z.enum(['ask', 'allowlist', 'all']).default('ask'),
  allowedTools: z.array(z.string()).default([]),
  sessionMode: z.enum(['isolated', 'main']).default('isolated'),
  maxIterations: z.number().int().positive().nullable().optional(),
  providerModelId: z.string().nullable().optional(),
  delivery: deliverySchema.default({ type: 'none' }),
});

export async function GET() {
  try {
    const { tenantId } = await resolveClawForSession();
    const tasks = await new ScheduledTaskService(tenantId).list();
    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list scheduled tasks');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { tenantId } = await resolveClawForSession();
    const task = await new ScheduledTaskService(tenantId).create(parsed.data);
    logger.info({ tenantId, taskId: task.taskId }, 'Scheduled task created');
    return NextResponse.json({ success: true, data: task }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    // A bad cadence is user error, not a server fault — surface the message itself.
    if (error instanceof InvalidScheduleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof TaskLimitError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    logger.error({ error }, 'Failed to create scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
