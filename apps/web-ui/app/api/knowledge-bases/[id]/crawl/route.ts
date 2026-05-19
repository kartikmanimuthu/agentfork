import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { DataSourceService, crawlTriggerSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';

const logger = createLogger('api:knowledge-bases:crawl');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let boss: ReturnType<typeof createBoss> | null = null;
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Crawl trigger request received');

    const { sourceId } = await parseJson(req, crawlTriggerSchema);
    logger.info({ knowledgeBaseId, sourceId }, 'Payload validated, fetching data source');

    const service = new DataSourceService(tenantId);
    const dataSource = await service.get(sourceId);

    if (!dataSource) {
      logger.warn({ knowledgeBaseId, sourceId }, 'Data source not found');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (dataSource.knowledgeBaseId !== knowledgeBaseId) {
      logger.warn({ knowledgeBaseId, sourceId, actualKbId: dataSource.knowledgeBaseId }, 'Data source does not belong to this knowledge base');
      return NextResponse.json(
        { error: 'Data source does not belong to this knowledge base' },
        { status: 400 }
      );
    }

    if (dataSource.type !== 'URL') {
      logger.warn({ knowledgeBaseId, sourceId, type: dataSource.type }, 'Data source is not a URL type');
      return NextResponse.json({ error: 'Data source is not a URL type' }, { status: 400 });
    }

    logger.debug({ knowledgeBaseId, sourceId }, 'Starting pg-boss for crawl enqueue');
    boss = createBoss();
    await boss.start();
    const jobId = await boss.send('web-crawl', { dataSourceId: sourceId, tenantId, knowledgeBaseId });
    await boss.stop({ graceful: false });
    boss = null;

    logger.info({ tenantId, knowledgeBaseId, sourceId, jobId }, 'Crawl job queued successfully');

    return NextResponse.json({ jobId, message: 'Crawl queued' }, { status: 202 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Crawl trigger failed');

    if (boss) {
      try { await boss.stop({ graceful: false }); } catch { /* ignore cleanup error */ }
    }

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
