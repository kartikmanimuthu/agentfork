import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { DataSourceService, updateDataSourceSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { sourceId } = await params;
    const service = new DataSourceService(tenantId);
    const source = await service.get(sourceId);

    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(source);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { sourceId } = await params;
    const body = await req.json();
    const input = updateDataSourceSchema.parse(body);

    const service = new DataSourceService(tenantId);
    const source = await service.update(sourceId, input);

    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(source);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { sourceId } = await params;
    const service = new DataSourceService(tenantId);
    const deleted = await service.delete(sourceId);

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
