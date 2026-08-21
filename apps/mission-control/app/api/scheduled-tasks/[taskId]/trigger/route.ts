import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { ScheduledTaskService } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';
import { enqueueScheduledTick } from '@/lib/queue';

const logger = createLogger('mission-control:api:scheduled-tasks:trigger');

/** POST — "Run now". Enqueues a tick rather than running inline: the graph takes
 *  minutes and this is a request handler. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const { tenantId } = await resolveClawForSession();
    const task = await new ScheduledTaskService(tenantId).get(taskId);
    if (!task) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (task.status === 'deleted') {
      return NextResponse.json({ success: false, error: 'That task was deleted.' }, { status: 410 });
    }

    // Same minute stamp the sweeper uses, so a manual run and a naturally-due tick
    // in the same minute contend for one lock instead of both firing.
    const scheduledAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    await enqueueScheduledTick({ taskId, tenantId, scheduledAt });

    logger.info({ tenantId, taskId, scheduledAt }, 'Scheduled task triggered manually');
    return NextResponse.json({ success: true, data: { taskId, scheduledAt } }, { status: 202 });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, taskId }, 'Failed to trigger scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
