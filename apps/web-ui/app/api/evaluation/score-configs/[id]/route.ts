import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ScoreConfigService } from '@chatbot/shared';
import { scoreConfigUpdateSchema, parseJson, ValidationError } from '@chatbot/shared';
import type { ScoreConfigDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@chatbot/shared';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:score-configs:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const config = await new ScoreConfigService(getPrismaClient() as unknown as ScoreConfigDb).get(tenantId, id);
    if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ config });
  } catch (error) {
    return handleError(error, 'get score config');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, scoreConfigUpdateSchema);
    const config = await new ScoreConfigService(getPrismaClient() as unknown as ScoreConfigDb).update(tenantId, id, body);
    return NextResponse.json({ config });
  } catch (error) {
    return handleError(error, 'update score config');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const config = await new ScoreConfigService(getPrismaClient() as unknown as ScoreConfigDb).archive(tenantId, id);
    return NextResponse.json({ config });
  } catch (error) {
    return handleError(error, 'archive score config');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
