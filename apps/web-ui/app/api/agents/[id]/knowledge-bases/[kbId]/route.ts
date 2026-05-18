import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { KnowledgeBaseAttachmentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:knowledge-bases[kbId]');

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; kbId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id, kbId } = await params;
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);

    await service.detach(id, kbId);
    logger.info({ tenantId, agentId: id, knowledgeBaseId: kbId }, 'Knowledge base detached from agent');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id, kbId: (await params).kbId }, 'Failed to detach knowledge base');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
