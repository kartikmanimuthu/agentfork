import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { KnowledgeBaseAttachmentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);
    const items = await service.findAttached(id);

    return NextResponse.json(items);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { knowledgeBaseId } = await req.json();
    const db = getPrismaClient();
    const service = new KnowledgeBaseAttachmentService(tenantId, db as any);

    const result = await service.attach(id, knowledgeBaseId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Knowledge base already attached' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
