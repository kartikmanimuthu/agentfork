import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DatasetService, createLogger } from '@chatbot/shared';
import { datasetUpdateSchema, parseJson } from '@chatbot/shared';
import type { DatasetDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:datasets:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dataset', authOptions);
    if (authError) return authError;
    const dataset = await new DatasetService(getPrismaClient() as unknown as DatasetDb).get(tenantId, id);
    if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ dataset });
  } catch (error) { return evalError(error, logger, 'get dataset'); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dataset', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, datasetUpdateSchema);
    const dataset = await new DatasetService(getPrismaClient() as unknown as DatasetDb).update(tenantId, id, body);
    return NextResponse.json({ dataset });
  } catch (error) { return evalError(error, logger, 'update dataset'); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Dataset', authOptions);
    if (authError) return authError;
    await new DatasetService(getPrismaClient() as unknown as DatasetDb).delete(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return evalError(error, logger, 'delete dataset'); }
}
