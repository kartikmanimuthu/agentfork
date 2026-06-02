import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getPrismaClient, createLogger, PausedExecutionService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../inference/lib/auth';
import { createBoss } from '@/lib/boss';

const logger = createLogger('api:resume');

const bodySchema = z.object({
  resumeToken: z.string().min(1),
  userInput: z.string().min(1, 'userInput is required'),
});

export async function POST(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId } = authResult.auth;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return new Response(
      JSON.stringify({ error: { type: 'invalid_request', message: 'resumeToken and userInput are required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { resumeToken, userInput } = body;
  const db = getPrismaClient();
  const pausedExecService = new PausedExecutionService(db);

  // Atomic CAS claim — prevents double-resume under concurrent requests
  const paused = await pausedExecService.claimToken(resumeToken);
  if (!paused) {
    return new Response(
      JSON.stringify({ error: { type: 'invalid_token', message: 'Resume token is invalid, expired, or already used' } }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (paused.tenantId !== tenantId) {
    return new Response(
      JSON.stringify({ error: { type: 'forbidden', message: 'Token does not belong to this tenant' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Enqueue worker job — execution happens async
  let boss: ReturnType<typeof createBoss> | null = null;
  try {
    boss = createBoss();
    await boss.start();
    await boss.createQueue('resume-agent-execution');
    await boss.send('resume-agent-execution', {
      pausedExecutionId: paused.id,
      userInput,
      tenantId,
    });
    await boss.stop({ graceful: false });
    boss = null;
  } catch (err) {
    if (boss) {
      try { await boss.stop({ graceful: false }); } catch { /* ignore */ }
    }
    logger.error({ err, pausedExecutionId: paused.id }, 'Failed to enqueue resume job');
    return new Response(
      JSON.stringify({ error: { type: 'internal_error', message: 'Failed to enqueue resume job' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  logger.info({ pausedExecutionId: paused.id, executionId: paused.executionId, tenantId }, 'Resume job enqueued');

  return new Response(
    JSON.stringify({ executionId: paused.executionId, status: 'queued' }),
    { status: 202, headers: { 'Content-Type': 'application/json' } }
  );
}
