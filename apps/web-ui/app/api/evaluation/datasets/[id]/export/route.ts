import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  DatasetService,
  DatasetItemService,
  exportDatasetItems,
  createLogger,
} from '@chatbot/shared';
import { datasetExportFormatSchema, ValidationError } from '@chatbot/shared';
import type { DatasetDb, DatasetItemDb, ExportableItem } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../lib/errors';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-export');

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'dataset';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'DatasetItem', authOptions);
    if (authError) return authError;

    const url = new URL(req.url);
    const parsedFormat = datasetExportFormatSchema.safeParse(url.searchParams.get('format') ?? undefined);
    if (!parsedFormat.success) throw new ValidationError(parsedFormat.error.issues);
    const format = parsedFormat.data;
    const includeArchived = url.searchParams.get('includeArchived') === 'true';

    const dataset = (await new DatasetService(getPrismaClient() as unknown as DatasetDb).get(tenantId, id)) as {
      name?: string;
    } | null;
    if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });

    const items = (await new DatasetItemService(getPrismaClient() as unknown as DatasetItemDb).list(tenantId, id, {
      includeArchived,
    })) as ExportableItem[];

    const { content, contentType, extension } = exportDatasetItems(items, format);
    const filename = `${slugify(dataset.name ?? 'dataset')}.${extension}`;

    logger.info({ tenantId, datasetId: id, format, count: items.length }, 'Exported dataset');

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': `${contentType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return evalError(error, logger, 'export dataset');
  }
}
