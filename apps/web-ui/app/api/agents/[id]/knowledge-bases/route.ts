import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, attachKnowledgeBaseSchema, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { KnowledgeBaseAttachmentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:knowledge-bases');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    logger.info({ tenantId, agentId: id }, 'List attached KBs request');

    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);
    const items = await service.findAttached(id);

    logger.info({ tenantId, agentId: id, count: items.length }, 'List attached KBs completed');
    return NextResponse.json(items);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const { id } = await params;
    logger.error({ errorMessage: err.message, errorStack: err.stack, agentId: id }, 'Failed to list attached knowledge bases');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    logger.info({ tenantId, agentId: id }, 'Attach KB request');

    const { knowledgeBaseId } = await parseJson(req, attachKnowledgeBaseSchema);
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);

    const result = await service.attach(id, knowledgeBaseId);
    logger.info({ tenantId, agentId: id, knowledgeBaseId }, 'Knowledge base attached to agent');
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const { id } = await params;
    logger.error({ errorMessage: err.message, errorStack: err.stack, agentId: id }, 'Failed to attach knowledge base');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Knowledge base already attached' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
