import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, DatasetItemService, createLogger } from '@chatbot/shared';
import { datasetItemCreateSchema, datasetItemBulkSchema, ValidationError } from '@chatbot/shared';
import type { DatasetItemDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-items');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'DatasetItem', authOptions);
    if (authError) return authError;
    const includeArchived = new URL(req.url).searchParams.get('includeArchived') === 'true';
    const items = await new DatasetItemService(getPrismaClient() as unknown as DatasetItemDb).list(tenantId, id, { includeArchived });
    return NextResponse.json({ items });
  } catch (error) { return evalError(error, logger, 'list dataset items'); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'DatasetItem', authOptions);
    if (authError) return authError;
    const raw = await req.json();
    const service = new DatasetItemService(getPrismaClient() as unknown as DatasetItemDb);
    if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
      const parsed = datasetItemBulkSchema.safeParse(raw);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const result = await service.bulkCreate(tenantId, id, parsed.data.items.map((i) => ({ ...i, createdBy: userId })), userId);
      return NextResponse.json({ result }, { status: 201 });
    }
    const parsed = datasetItemCreateSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const item = await service.create(tenantId, id, { ...parsed.data, createdBy: userId });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return evalError(error, logger, 'create dataset item'); }
}
