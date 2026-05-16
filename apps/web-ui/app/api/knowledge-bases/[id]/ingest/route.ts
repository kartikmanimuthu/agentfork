import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { IngestionService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';
import { createLogger } from '@chatbot/shared';
import { z } from 'zod';

const logger = createLogger('api:kb:ingest');

const ingestRequestSchema = z.object({
  documentId: z.string().cuid(),
  s3Key: z.string().min(1),
  mimeType: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: knowledgeBaseId } = await params;

    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = ingestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const { documentId, s3Key, mimeType } = parsed.data;

    const boss = createBoss();
    await boss.start();
    await boss.createQueue('document-ingestion');

    const ingestionService = new IngestionService(tenantId);
    const jobId = await ingestionService.enqueueIngestion(boss, {
      documentId,
      tenantId,
      s3Key,
      mimeType,
      knowledgeBaseId,
    });

    await boss.stop({ graceful: false });

    logger.info({ documentId, jobId }, 'Ingestion job enqueued');

    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message }, 'Failed to enqueue ingestion job');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Internal server error', detail: err.message },
      { status: 500 }
    );
  }
}
