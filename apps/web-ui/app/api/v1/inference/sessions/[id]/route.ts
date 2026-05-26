import { NextRequest, NextResponse } from 'next/server';
import {
  getPrismaClient,
  InferenceSessionService,
  createLogger,
} from '@chatbot/shared';
import { validateInferenceApiKey } from '../../lib/auth';
import { createBoss } from '@/lib/boss';

const logger = createLogger('api:inference:sessions:[id]');
const ANALYTICS_JOB = 'inference-session-analytics';

/**
 * GET /api/v1/inference/sessions/{id}
 * Returns the active session (with messages) or 410 if ended or idle-expired.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { tenantId, apiKeyId } = authResult.auth;
  const { id } = await params;

  try {
    const db = getPrismaClient();
    const service = new InferenceSessionService(db);

    // Verify ownership before returning anything.
    const owned = await db.inferenceSession.findFirst({
      where: { id, tenantId, apiKeyId },
      select: { id: true, status: true, idleExpiresAt: true },
    });

    if (!owned) {
      return NextResponse.json(
        { error: { type: 'session_not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const session = await service.findActiveById(id);
    if (!session) {
      // Session is ended or idle-expired; integrator should create a new one.
      return NextResponse.json(
        { error: { type: 'session_expired', message: 'Session not found, ended, or idle-expired' } },
        { status: 410 }
      );
    }

    return NextResponse.json(session, { status: 200 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, sessionId: id }, 'Failed to get session');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to get session' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v1/inference/sessions/{id}
 *
 * Ends the session (reason: closed) and enqueues the analytics job — same as the dedicated
 * /close endpoint. The row is preserved so the analytics worker can read its messages and
 * the Sessions dashboard can show the closed conversation.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { tenantId, apiKeyId } = authResult.auth;
  const { id } = await params;

  let boss: ReturnType<typeof createBoss> | null = null;
  try {
    const db = getPrismaClient();
    const service = new InferenceSessionService(db);

    const existing = await db.inferenceSession.findFirst({
      where: { id, tenantId, apiKeyId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { type: 'session_not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    if (existing.status === 'active') {
      await service.endSession(id, 'closed');

      boss = createBoss();
      await boss.start();
      await boss.createQueue(ANALYTICS_JOB);
      await boss.send(ANALYTICS_JOB, { sessionId: id, tenantId });
      await boss.stop({ graceful: false });
      boss = null;

      logger.info({ tenantId, sessionId: id }, 'Session deleted (closed) and analytics enqueued');
    } else {
      logger.info({ tenantId, sessionId: id, status: existing.status }, 'DELETE on already-ended session — no-op');
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, sessionId: id }, 'Failed to delete session');
    if (boss) {
      try {
        await boss.stop({ graceful: false });
      } catch {
        // ignore cleanup error
      }
    }
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to delete session' } },
      { status: 500 }
    );
  }
}
