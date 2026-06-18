import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, ScoreConfigService } from '@chatbot/shared';
import { scoreConfigCreateSchema, parseJson, ValidationError } from '@chatbot/shared';
import type { ScoreConfigDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@chatbot/shared';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:score-configs');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const includeArchived = new URL(req.url).searchParams.get('includeArchived') === 'true';
    const service = new ScoreConfigService(getPrismaClient() as unknown as ScoreConfigDb);
    const configs = await service.list(tenantId, { includeArchived });
    return NextResponse.json({ configs });
  } catch (error) {
    return handleError(error, 'list score configs');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, scoreConfigCreateSchema);
    const service = new ScoreConfigService(getPrismaClient() as unknown as ScoreConfigDb);
    const config = await service.create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    return handleError(error, 'create score config');
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
