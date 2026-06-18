import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DatasetItemService, createLogger } from '@chatbot/shared';
import { parseJson } from '@chatbot/shared';
import type { DatasetItemDb } from '@chatbot/shared';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-item');

const itemPatchSchema = z.object({
  input: z.unknown().optional(),
  expectedOutput: z.unknown().optional(),
  metadata: z.unknown().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'DatasetItem', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, itemPatchSchema);
    const item = await new DatasetItemService(getPrismaClient() as unknown as DatasetItemDb).update(tenantId, id, itemId, body);
    return NextResponse.json({ item });
  } catch (error) { return evalError(error, logger, 'update dataset item'); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'DatasetItem', authOptions);
    if (authError) return authError;
    await new DatasetItemService(getPrismaClient() as unknown as DatasetItemDb).delete(tenantId, id, itemId);
    return NextResponse.json({ ok: true });
  } catch (error) { return evalError(error, logger, 'delete dataset item'); }
}
