import { NextRequest, NextResponse } from 'next/server';
import {
  getPrismaClient,
  InferenceSessionService,
  createLogger,
} from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../lib/auth';
import { createBoss } from '@/lib/boss';

const logger = createLogger('api:inference:sessions:close');

const ANALYTICS_JOB = 'inference-session-analytics';

/**
 * POST /api/v1/inference/sessions/{id}/close
 *
 * Marks the session as ended (reason: closed) and enqueues the analytics job.
 * Idempotent: closing an already-ended session is a successful no-op (no double-enqueue).
 *
 * Returns 204 No Content on success.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Lookup must scope to the calling api key's tenant + apiKey to avoid cross-tenant closes.
    const existing = await db.inferenceSession.findFirst({
      where: { id, tenantId, apiKeyId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { type: 'session_not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const wasActive = existing.status === 'active';

    if (wasActive) {
      await service.endSession(id, 'closed');

      boss = createBoss();
      await boss.start();
      // Ensure the analytics queue exists (pg-boss v10 requires it before send).
      await boss.createQueue(ANALYTICS_JOB);
      await boss.send(ANALYTICS_JOB, { sessionId: id, tenantId });
      await boss.stop({ graceful: false });
      boss = null;

      logger.info({ tenantId, sessionId: id }, 'Session closed and analytics job enqueued');
    } else {
      logger.info({ tenantId, sessionId: id, status: existing.status }, 'Close called on already-ended session — no-op');
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack, sessionId: id }, 'Failed to close session');
    if (boss) {
      try {
        await boss.stop({ graceful: false });
      } catch {
        // ignore cleanup error
      }
    }
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to close session' } },
      { status: 500 }
    );
  }
}
