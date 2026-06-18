import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, DatasetItemService, createLogger } from '@chatbot/shared';
import { addFromTraceSchema, parseJson } from '@chatbot/shared';
import type { DatasetItemDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../../lib/errors';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-from-trace');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'DatasetItem', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, addFromTraceSchema);
    const item = await new DatasetItemService(getPrismaClient() as unknown as DatasetItemDb).addFromTrace({ ...body, tenantId, datasetId: id, createdBy: userId });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return evalError(error, logger, 'add item from trace'); }
}
