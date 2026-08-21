import { NextRequest, NextResponse } from 'next/server';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:scheduled-tasks:runs');

const PAGE_SIZE = 50;

/**
 * Run history for one task. Scheduled runs are ordinary ClawRuns — they also appear
 * in the global /runs list — so this filters on the taskId stamped into `trigger`
 * when the run was created.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const { tenantId } = await resolveClawForSession();
    const runs = await getPrismaClient().clawRun.findMany({
      where: { tenantId, source: 'scheduled', trigger: { path: ['taskId'], equals: taskId } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        runId: true, status: true, createdAt: true, completedAt: true,
        taskDescription: true, error: true,
      },
    });
    return NextResponse.json({ success: true, data: runs });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, taskId }, 'Failed to list runs for scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
