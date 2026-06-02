import { NextRequest } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../inference/lib/auth';

const logger = createLogger('api:executions');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId } = authResult.auth;
  const { id } = await params;

  const db = getPrismaClient();
  const execution = await db.apiKeyExecution.findUnique({ where: { id } });

  if (!execution || execution.tenantId !== tenantId) {
    return new Response(
      JSON.stringify({ error: { type: 'not_found', message: 'Execution not found' } }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  logger.debug({ executionId: id, status: execution.status, tenantId }, 'Execution status polled');

  return new Response(
    JSON.stringify({
      executionId: id,
      status: execution.status,
      output: execution.output ?? null,
      error: execution.error ?? null,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
