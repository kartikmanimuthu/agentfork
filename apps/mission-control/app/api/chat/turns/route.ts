import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import { getRunService } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat:turns');

/**
 * Per-turn metrics for a whole conversation: what each answer cost and how long it
 * took.
 *
 * One request for the entire transcript rather than one per message. The chat view
 * labels every assistant bubble with its response time and token counts, and a
 * long conversation would otherwise fire dozens of requests on every render.
 *
 * Events are deliberately NOT included — the tool calls and thinking behind a turn
 * are fetched from /api/runs/[runId] only when the user expands that turn. A
 * hundred-turn conversation's full timeline is orders of magnitude more data than
 * the labels need, and almost none of it is ever looked at.
 */
const querySchema = z.object({ sessionId: z.string().min(1) });

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;

    const parsed = querySchema.safeParse({
      sessionId: new URL(req.url).searchParams.get('sessionId') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    // Tenant-scoped through the session, same as /api/chat/active.
    const db = getPrismaClient();
    const chatSession = await db.clawChatSession.findFirst({
      where: { id: parsed.data.sessionId, tenantId },
      select: { threadId: true },
    });
    if (!chatSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const runs = await getRunService().listByThread(chatSession.threadId, tenantId);

    // Keyed by runId because that is what the client holds on each assistant
    // message; an array would just make it build this map itself.
    const turns = Object.fromEntries(
      runs.map((run) => [
        run.runId,
        {
          status: run.status,
          // Response time as the user experienced it. `result.durationMs` is
          // recorded by the chat route; the createdAt→completedAt fallback covers
          // runs from before that existed, and gateway/scheduled runs.
          durationMs:
            run.result?.durationMs ??
            (run.completedAt ? run.completedAt.getTime() - run.createdAt.getTime() : null),
          // Absent for turns predating usage capture, and zeroed for providers that
          // report none — the UI omits the label rather than showing "0 tokens".
          usage: run.result?.usage ?? null,
          error: run.error,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        },
      ]),
    );

    return NextResponse.json({ success: true, data: { turns } });
  } catch (error) {
    logger.error({ error }, 'Failed to list chat turn metrics');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
