import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, EvaluatorService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { evaluatorUpdateSchema } from '@chatbot/shared';
import type { EvaluatorDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:evaluators:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Evaluator', authOptions);
    if (authError) return authError;
    const service = new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb);
    const evaluator = await service.get(tenantId, id);
    if (!evaluator) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ evaluator });
  } catch (error) {
    return handleError(error, 'get evaluator');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Evaluator', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, evaluatorUpdateSchema);
    const service = new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb);
    const evaluator = await service.update(tenantId, id, body);
    return NextResponse.json({ evaluator });
  } catch (error) {
    return handleError(error, 'update evaluator');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Evaluator', authOptions);
    if (authError) return authError;
    const service = new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb);
    await service.disable(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, 'disable evaluator');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  }
  if (error instanceof Error && error.message.includes('Unauthenticated')) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
