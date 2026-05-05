import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { KnowledgeBaseService, createKnowledgeBaseSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const status = searchParams.get('status') ?? undefined;

    const service = new KnowledgeBaseService(tenantId);
    const result = await service.list({ limit, offset, status });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const input = createKnowledgeBaseSchema.parse(body);

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.create(input);

    return NextResponse.json(kb, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('ZodError')) {
      return NextResponse.json({ error: 'Invalid input', details: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
