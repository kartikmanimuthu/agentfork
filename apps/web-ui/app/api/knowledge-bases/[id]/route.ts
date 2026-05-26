import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { KnowledgeBaseService, updateKnowledgeBaseSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:detail');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Get KB request');

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.get(knowledgeBaseId);

    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, knowledgeBaseId }, 'Get KB completed');
    return NextResponse.json(kb);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Get KB failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Update KB request');

    const input = await parseJson(req, updateKnowledgeBaseSchema);

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.update(knowledgeBaseId, input);

    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, knowledgeBaseId }, 'KB updated');
    return NextResponse.json(kb);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Update KB failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Delete KB request');

    const service = new KnowledgeBaseService(tenantId);
    const deleted = await service.delete(knowledgeBaseId);

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, knowledgeBaseId }, 'KB deleted');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Delete KB failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
