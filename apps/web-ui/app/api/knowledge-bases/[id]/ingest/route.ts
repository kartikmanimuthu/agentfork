import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { IngestionService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';
import { z } from 'zod';

const logger = createLogger('api:kb:ingest');

const ingestRequestSchema = z.object({
  documentId: z.string().cuid(),
  s3Key: z.string().min(1),
  mimeType: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let boss: ReturnType<typeof createBoss> | null = null;
  try {
    const { id: knowledgeBaseId } = await params;

    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    logger.info({ tenantId, knowledgeBaseId }, 'Ingest request received');

    const { documentId, s3Key, mimeType } = await parseJson(req, ingestRequestSchema);
    logger.info({ knowledgeBaseId, documentId, s3Key, mimeType }, 'Payload validated, starting pg-boss');

    boss = createBoss();
    await boss.start();
    await boss.createQueue('document-ingestion');
    logger.debug({ knowledgeBaseId }, 'pg-boss started and queue created');

    const ingestionService = new IngestionService(tenantId);
    const jobId = await ingestionService.enqueueIngestion(boss, {
      documentId,
      tenantId,
      s3Key,
      mimeType,
      knowledgeBaseId,
    });

    await boss.stop({ graceful: false });
    boss = null;

    logger.info({ knowledgeBaseId, documentId, jobId }, 'Ingestion job enqueued successfully');

    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Failed to enqueue ingestion job');

    if (boss) {
      try { await boss.stop({ graceful: false }); } catch { /* ignore cleanup error */ }
    }

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Internal server error', detail: err.message },
      { status: 500 }
    );
  }
}
