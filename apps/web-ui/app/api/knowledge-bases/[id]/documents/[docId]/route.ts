import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { DocumentService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { docId } = await params;
    const service = new DocumentService(tenantId);
    const doc = await service.get(docId);

    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(doc);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { docId } = await params;
    const service = new DocumentService(tenantId);
    const deleted = await service.delete(docId);

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
