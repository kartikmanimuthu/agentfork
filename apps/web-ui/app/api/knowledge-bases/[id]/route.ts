import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { KnowledgeBaseService, updateKnowledgeBaseSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.get(id);

    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(kb);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const input = updateKnowledgeBaseSchema.parse(body);

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.update(id, input);

    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(kb);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new KnowledgeBaseService(tenantId);
    const deleted = await service.delete(id);

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
