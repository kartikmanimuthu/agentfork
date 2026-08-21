/**
 * POST /api/runs/{runId}/action — the dashboard's resume path.
 *
 * The design reference (§7) calls for a second, independently-authenticated way
 * to answer a HIL prompt: the channel path trusts a platform signature, this one
 * trusts the session. Because no adapter validated a platform identity here, it
 * has to check ownership itself (run.tenantId === session tenant).
 *
 * Both paths converge on the same queue and the same executor, so approving from
 * the dashboard still notifies the channel the run came from.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, AuditService } from '@chatbot/shared';
import { getRunService, isTerminalStatus, type RunStatus } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';
import { enqueueGatewayRun } from '@/lib/queue';

const logger = createLogger('mission-control:api:runs:action');

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('approve_always') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('respond'), content: z.string().trim().min(1).max(4000) }),
]);

/** Statuses each action is meaningful from. */
const REQUIRED_STATUS: Record<string, RunStatus[]> = {
  approve: ['awaiting_approval'],
  approve_always: ['awaiting_approval'],
  reject: ['awaiting_approval'],
  respond: ['awaiting_input'],
  cancel: ['queued', 'in_progress', 'awaiting_input', 'awaiting_approval'],
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  let runId = 'unknown';
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    ({ runId } = await params);
    const tenantId = session.studio.tenantId;
    const actor = session.studio.studioId;

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { action } = parsed.data;

    const runs = getRunService();
    const run = await runs.get(runId, tenantId);
    if (!run) {
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    }
    if (isTerminalStatus(run.status)) {
      return NextResponse.json(
        { success: false, error: `This run already ${run.status}.` },
        { status: 409 },
      );
    }
    if (!REQUIRED_STATUS[action].includes(run.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot ${action} a run that is ${run.status}.` },
        { status: 409 },
      );
    }

    if (action === 'cancel' && run.status === 'in_progress') {
      // The worker owns the AbortController for an executing run and can't be
      // signalled from this process, so the status flip IS the signal — it
      // notices between graph steps, aborts, and notifies the channel itself.
      // Queueing a cancel job as well would double-notify.
      await runs.markCancelled(runId, 'Cancelled from the dashboard.');
    } else {
      await enqueueGatewayRun({
        runId,
        tenantId,
        action: action === 'respond' ? 'clarification_response' : action,
        ...(action === 'respond' ? { content: parsed.data.content } : {}),
      });
    }

    AuditService.logUserAction({
      eventType: `claw.run.${action}`,
      action: `Claw run ${action}`,
      resourceType: 'claw_run',
      resourceId: runId,
      resourceName: run.taskDescription.slice(0, 120),
      user: actor,
      userType: 'user',
      status: 'success',
      severity: action === 'approve' || action === 'approve_always' ? 'high' : 'medium',
      details: `${action} on a ${run.source} run`,
      apiRoute: `POST /api/runs/${runId}/action`,
      httpMethod: 'POST',
      metadata: { tenantId, runId, source: run.source, previousStatus: run.status },
      tenantId,
    }).catch(() => {});

    logger.info({ runId, tenantId, action, previousStatus: run.status }, 'Run action accepted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error, runId }, 'Run action failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
