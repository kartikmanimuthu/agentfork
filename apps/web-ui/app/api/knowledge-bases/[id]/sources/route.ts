import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { DataSourceService, createDataSourceSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const service = new DataSourceService(tenantId);
    const result = await service.list(id, { limit, offset });

    return NextResponse.json(result);
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const input = createDataSourceSchema.parse({ ...body, knowledgeBaseId: id });

    const service = new DataSourceService(tenantId);
    const source = await service.create(input);

    return NextResponse.json(source, { status: 201 });
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
