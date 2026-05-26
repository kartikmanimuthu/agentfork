import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { RetrievalService, retrievalOptionsSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('api:knowledge-bases:search');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Search request');

    const body = await parseJson(req, z.object({ query: z.string().min(1) }).and(retrievalOptionsSchema.omit({ knowledgeBaseId: true })));
    const { query, ...optionsRaw } = body;

    const options = retrievalOptionsSchema.parse({ ...optionsRaw, knowledgeBaseId });
    const service = new RetrievalService(tenantId);
    const results = await service.query(query, options);

    logger.info({ tenantId, knowledgeBaseId, resultCount: results.length }, 'Search completed');
    return NextResponse.json({ results, count: results.length });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Search failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
