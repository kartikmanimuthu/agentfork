import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { DocumentService, IngestionService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';
import { createLogger } from '@chatbot/shared';
import { z } from 'zod';

const logger = createLogger('api:kb:upload');

const uploadRequestSchema = z.object({
  dataSourceId: z.string().min(1),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: knowledgeBaseId } = await params;
    logger.info({ knowledgeBaseId }, 'Upload request received');

    const tenantId = await getSessionTenantId(authOptions);
    logger.info({ tenantId }, 'Tenant resolved from session');

    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) {
      logger.warn({ tenantId, knowledgeBaseId }, 'Authorization failed for upload');
      return authError;
    }
    logger.info({ tenantId, knowledgeBaseId }, 'Authorization passed');

    const body = await req.json();
    logger.debug({ body }, 'Request body parsed');

    const parsed = uploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      logger.warn({ issues, body }, 'Upload request validation failed');
      return NextResponse.json(
        { error: issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const { dataSourceId: sourceId, fileName, mimeType, sizeBytes } = parsed.data;
    logger.info(
      { knowledgeBaseId, sourceId, fileName, mimeType, sizeBytes },
      'Upload request validated'
    );

    const docService = new DocumentService(tenantId);

    // Get pre-signed upload URL
    logger.info({ sourceId, fileName, mimeType }, 'Generating S3 pre-signed upload URL');
    const { uploadUrl, s3Key } = await docService.getUploadUrl(sourceId, fileName, mimeType);
    logger.info({ s3Key }, 'S3 pre-signed upload URL generated');

    // Create document record in PENDING state
    logger.info({ sourceId, s3Key, fileName, mimeType, sizeBytes }, 'Creating document record');
    const document = await docService.create({
      dataSourceId: sourceId,
      sourceKey: s3Key,
      fileName,
      mimeType,
      sizeBytes,
    });
    logger.info({ documentId: document.id }, 'Document record created');

    // Enqueue ingestion job (fires after client uploads to S3)
    logger.info({ documentId: document.id, knowledgeBaseId }, 'Enqueuing ingestion job');
    const ingestionService = new IngestionService(tenantId);
    const boss = createBoss();
    logger.info({}, 'pg-boss instance created');

    await boss.start();
    logger.info({}, 'pg-boss started');

    await boss.createQueue('document-ingestion');

    const jobId = await ingestionService.enqueueIngestion(boss, {
      documentId: document.id,
      tenantId,
      s3Key,
      mimeType,
      knowledgeBaseId,
    });
    logger.info({ jobId }, 'Ingestion job enqueued');

    await boss.stop({ graceful: false });
    logger.info({}, 'pg-boss stopped');

    logger.info(
      { documentId: document.id, s3Key, jobId },
      'Upload flow completed successfully'
    );

    return NextResponse.json({ uploadUrl, document }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        errorMessage: err.message,
        errorStack: err.stack,
        errorName: err.name,
      },
      'Upload flow failed'
    );

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Internal server error', detail: err.message },
      { status: 500 }
    );
  }
}
