import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ExperimentService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { experimentUpdateSchema } from '@chatbot/shared';
import type { ExperimentDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:experiments:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Experiment', authOptions);
    if (authError) return authError;
    const service = new ExperimentService(getPrismaClient() as unknown as ExperimentDb);
    const experiment = await service.get(tenantId, id);
    if (!experiment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ experiment });
  } catch (error) {
    return handleError(error, 'get experiment');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Experiment', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, experimentUpdateSchema);
    const service = new ExperimentService(getPrismaClient() as unknown as ExperimentDb);
    const experiment = await service.update(tenantId, id, body);
    return NextResponse.json({ experiment });
  } catch (error) {
    return handleError(error, 'update experiment');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Experiment', authOptions);
    if (authError) return authError;
    const service = new ExperimentService(getPrismaClient() as unknown as ExperimentDb);
    await service.delete(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, 'delete experiment');
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
