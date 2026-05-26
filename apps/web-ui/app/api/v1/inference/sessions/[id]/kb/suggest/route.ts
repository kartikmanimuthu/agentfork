import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../../lib/auth';

const logger = createLogger('api:inference:sessions:kb-suggest');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { agentId, tenantId } = authResult.auth;

  const query = req.nextUrl.searchParams.get('q');
  if (!query || query.length < 3) {
    return NextResponse.json(
      { error: { type: 'validation_error', message: 'Query must be at least 3 characters' } },
      { status: 400 }
    );
  }

  try {
    const db = getPrismaClient();

    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId: authResult.auth.apiKeyId },
    });
    if (!session) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const attachments = await db.agentKnowledgeBase.findMany({
      where: { agentId },
      include: { knowledgeBase: true },
    });

    if (!attachments || attachments.length === 0) {
      return NextResponse.json({ articles: [] });
    }

    const { RetrievalService } = await import('@chatbot/knowledge-base');
    const retrieval = new RetrievalService(tenantId);

    const articles: Array<{ id: string; title: string; snippet: string }> = [];

    for (const att of attachments) {
      const kb = att.knowledgeBase as { id: string; name: string; status: string };
      if (kb.status !== 'active') continue;

      try {
        const results = await retrieval.query(query, { knowledgeBaseId: kb.id, topK: 3 });
        for (const r of results) {
          articles.push({
            id: (r as any).id ?? crypto.randomUUID(),
            title: kb.name,
            snippet: ((r as any).content ?? '').slice(0, 200),
          });
        }
      } catch (err) {
        logger.warn({ err, kbId: kb.id }, 'KB retrieval failed');
      }
    }

    return NextResponse.json({ articles: articles.slice(0, 5) });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'KB suggest failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to fetch suggestions' } },
      { status: 500 }
    );
  }
}
