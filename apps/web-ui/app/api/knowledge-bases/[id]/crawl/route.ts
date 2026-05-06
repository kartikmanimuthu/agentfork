import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { DataSourceService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    const { sourceId } = await req.json();

    if (!sourceId) {
      return NextResponse.json({ error: 'sourceId is required' }, { status: 400 });
    }

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
    const jobId = await boss.send('web-crawl', { dataSourceId: sourceId, tenantId, knowledgeBaseId });
    await boss.stop({ graceful: false });

    return NextResponse.json({ jobId, message: 'Crawl queued' }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
