import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  ScoreService,
  createLogger,
} from '@chatbot/shared';
import {
  scoreManualCreateSchema,
  scoreListQuerySchema,
  parseJson,
  parseSearchParams,
  ValidationError,
} from '@chatbot/shared';
import type { ScoreDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:scores');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Score', authOptions);
    if (authError) return authError;
    const filters = parseSearchParams(new URL(req.url).searchParams, scoreListQuerySchema);
    const service = new ScoreService(getPrismaClient() as unknown as ScoreDb);
    const scores = await service.listByTenant(tenantId, filters);
    return NextResponse.json({ scores });
  } catch (error) {
    return handleError(error, 'list scores');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Score', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, scoreManualCreateSchema);
    const service = new ScoreService(getPrismaClient() as unknown as ScoreDb);
    const score = await service.createManual({ ...body, tenantId, authorUserId: userId });
    return NextResponse.json({ score }, { status: 201 });
  } catch (error) {
    return handleError(error, 'create score');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  }
  if (error instanceof Error && error.message.includes('Unauthenticated')) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  if (error instanceof Error && /not found/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof Error && /(range|categor|requires)/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
