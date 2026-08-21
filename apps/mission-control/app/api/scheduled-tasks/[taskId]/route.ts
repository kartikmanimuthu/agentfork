import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { InvalidScheduleError, ScheduledTaskService } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:scheduled-tasks:id');

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  // Pause/resume is just a status change — no separate endpoints needed.
  status: z.enum(['active', 'paused']).optional(),
  scheduleType: z.enum(['cron', 'interval', 'once']).optional(),
  cronExpression: z.string().optional(),
  intervalMinutes: z.number().int().positive().nullable().optional(),
  runAt: z.string().nullable().optional(),
  timezone: z.string().optional(),
  approvalMode: z.enum(['ask', 'allowlist', 'all']).optional(),
  allowedTools: z.array(z.string()).optional(),
  sessionMode: z.enum(['isolated', 'main']).optional(),
  maxIterations: z.number().int().positive().nullable().optional(),
  providerModelId: z.string().nullable().optional(),
  delivery: z.object({
    type: z.enum(['slack', 'telegram', 'discord', 'jira', 'email', 'none']),
    target: z.string().optional(),
  }).optional(),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const { tenantId } = await resolveClawForSession();
    const task = await new ScheduledTaskService(tenantId).get(taskId);
    if (!task) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, taskId }, 'Failed to read scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { tenantId } = await resolveClawForSession();
    const task = await new ScheduledTaskService(tenantId).update(taskId, parsed.data);
    if (!task) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    logger.info({ tenantId, taskId }, 'Scheduled task updated');
    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof InvalidScheduleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    logger.error({ error, taskId }, 'Failed to update scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const { tenantId } = await resolveClawForSession();
    const service = new ScheduledTaskService(tenantId);
    if (!(await service.get(taskId))) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    // Soft delete: run history references taskId, so the row has to survive.
    await service.remove(taskId);
    logger.info({ tenantId, taskId }, 'Scheduled task deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, taskId }, 'Failed to delete scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
