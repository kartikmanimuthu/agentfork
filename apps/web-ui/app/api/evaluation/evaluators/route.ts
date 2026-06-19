import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, EvaluatorService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { evaluatorCreateSchema } from '@chatbot/shared';
import type { EvaluatorDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:evaluators');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Evaluator', authOptions);
    if (authError) return authError;
    const service = new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb);
    const evaluators = await service.list(tenantId);
    return NextResponse.json({ evaluators });
  } catch (error) {
    return handleError(error, 'list evaluators');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Evaluator', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, evaluatorCreateSchema);
    const service = new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb);
    const evaluator = await service.create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ evaluator }, { status: 201 });
  } catch (error) {
    return handleError(error, 'create evaluator');
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
