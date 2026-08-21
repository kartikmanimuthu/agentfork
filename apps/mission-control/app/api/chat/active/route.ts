import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import { getRunService, isTerminalStatus } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat:active');

/**
 * The turn a reloaded page was watching, plus the timeline it missed.
 *
 * A chat turn's progress used to exist only inside the SSE response it was
 * streaming into, so refreshing or closing the tab lost it permanently — the run
 * was aborted and nothing had recorded what it produced. Chat turns are now
 * persisted runs (`CHAT_SOURCE`), and this is how a fresh page picks one back up:
 * it resolves its session's thread, asks for the latest run on it, and replays the
 * events already recorded.
 *
 * `after` makes it a poll cursor as well as a replay: pass the id of the last
 * event already rendered and only newer ones come back, so following a live turn
 * costs one small query per tick instead of the whole timeline every time.
 *
 * A polled GET rather than a second SSE stream, on purpose. CloudFront's 60s
 * originReadTimeout measures the gap between bytes and already forced a heartbeat
 * onto the main chat stream (see the POST handler); a short poll has none of that
 * fragility, needs no keepalive, and behaves the same whichever replica answers —
 * which matters here precisely because the turn may be finishing in a different
 * container than the one this request lands on.
 */
const querySchema = z.object({
  sessionId: z.string().min(1),
  after: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      sessionId: url.searchParams.get('sessionId') ?? undefined,
      after: url.searchParams.get('after') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    // Tenant-scoped: the session id arrives from the browser, and the thread it
    // resolves to is what grants access to the run and its events.
    const db = getPrismaClient();
    const chatSession = await db.clawChatSession.findFirst({
      where: { id: parsed.data.sessionId, tenantId },
      select: { threadId: true },
    });
    if (!chatSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const runs = getRunService();
    const run = await runs.findLatestByThread(chatSession.threadId, tenantId);
    // No run at all is the normal answer for a session that has never been used,
    // and for every session that predates chat turns becoming runs. Not an error.
    if (!run) {
      return NextResponse.json({ success: true, data: { run: null, events: [], live: false } });
    }

    const events = await runs.listEvents(run.runId, tenantId, parsed.data.after);

    return NextResponse.json({
      success: true,
      data: {
        run: {
          runId: run.runId,
          status: run.status,
          // The finished answer, for the case this whole endpoint exists for: the
          // turn completed while the page was away.
          answer: run.result?.answer ?? null,
          approvalRequest: run.approvalRequest,
          error: run.error,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        },
        events,
        /** Whether the client should keep polling. */
        live: !isTerminalStatus(run.status),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to resolve the active chat run');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
