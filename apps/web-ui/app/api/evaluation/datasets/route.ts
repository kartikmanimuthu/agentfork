import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, DatasetService, createLogger } from '@chatbot/shared';
import { datasetCreateSchema, parseJson, ValidationError } from '@chatbot/shared';
import type { DatasetDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:datasets');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dataset', authOptions);
    if (authError) return authError;
    const datasets = await new DatasetService(getPrismaClient() as unknown as DatasetDb).list(tenantId);
    return NextResponse.json({ datasets });
  } catch (error) {
    return evalError(error, logger, 'list datasets');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Dataset', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, datasetCreateSchema);
    const dataset = await new DatasetService(getPrismaClient() as unknown as DatasetDb).create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    return evalError(error, logger, 'create dataset');
  }
}

// shared error helper used by all evaluation dataset routes
export function evalError(error: unknown, log: ReturnType<typeof createLogger>, action: string): NextResponse {
  if (error instanceof ValidationError) return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
  log.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
