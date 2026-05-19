import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, parseSearchParams, ValidationError } from '@chatbot/shared';
import { KnowledgeBaseService, createKnowledgeBaseSchema, kbListQuerySchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const query = parseSearchParams(searchParams, kbListQuerySchema);

    logger.info({ tenantId, limit: query.limit, offset: query.offset, status: query.status }, 'List KBs request');

    const service = new KnowledgeBaseService(tenantId);
    const result = await service.list({ limit: query.limit, offset: query.offset, status: query.status });

    logger.info({ tenantId, count: result.items.length }, 'List KBs completed');
    return NextResponse.json(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'List KBs failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    logger.info({ tenantId }, 'Create KB request');

    const input = await parseJson(req, createKnowledgeBaseSchema);

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.create(input);

    logger.info({ tenantId, knowledgeBaseId: kb.id }, 'KB created');
    return NextResponse.json(kb, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Create KB failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
