import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { DataSourceService, syncSourceSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';

const logger = createLogger('api:knowledge-bases:sync');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId, sourceId } = await params;
    logger.info({ tenantId, knowledgeBaseId, sourceId }, 'Sync request');

    const body = await parseJson(req, syncSourceSchema);
    const { force } = body;

    const service = new DataSourceService(tenantId);
    const dataSource = await service.get(sourceId);

    if (!dataSource) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (dataSource.knowledgeBaseId !== knowledgeBaseId) {
      return NextResponse.json(
        { error: 'Data source does not belong to this knowledge base' },
        { status: 400 }
      );
    }

    if (dataSource.type !== 'URL') {
      return NextResponse.json({ error: 'Data source is not a URL type' }, { status: 400 });
    }

    const boss = createBoss();
    await boss.start();
    const jobId = await boss.send('web-crawl', { dataSourceId: sourceId, tenantId, knowledgeBaseId, force });
    await boss.stop({ graceful: false });

    logger.info({ tenantId, knowledgeBaseId, sourceId, jobId, force }, 'Sync job queued');
    return NextResponse.json({ jobId, message: 'Sync queued' }, { status: 202 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Sync failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
