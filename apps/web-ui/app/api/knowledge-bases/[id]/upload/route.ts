import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, S3Service, ValidationError } from '@chatbot/shared';
import { DocumentService, IngestionService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';

const logger = createLogger('api:kb:upload');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let boss: ReturnType<typeof createBoss> | null = null;
  try {
    const { id: knowledgeBaseId } = await params;
    logger.info({ knowledgeBaseId }, 'Upload request received');

    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const dataSourceId = formData.get('dataSourceId') as string | null;

    if (!file || !dataSourceId) {
      return NextResponse.json({ error: 'file and dataSourceId are required' }, { status: 400 });
    }

    const fileName = file.name;
    const mimeType = file.type || 'application/octet-stream';
    const sizeBytes = file.size;

    logger.info({ knowledgeBaseId, dataSourceId, fileName, mimeType, sizeBytes }, 'File received, uploading to S3');

    const docService = new DocumentService(tenantId);
    const s3Key = `${tenantId}/${dataSourceId}/${Date.now()}-${fileName}`;

    const s3 = new S3Service();
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.uploadBuffer(s3Key, buffer, mimeType);
    logger.info({ s3Key, sizeBytes: buffer.length }, 'File uploaded to S3');

    const document = await docService.create({
      dataSourceId,
      sourceKey: s3Key,
      fileName,
      mimeType,
      sizeBytes,
    });
    logger.info({ documentId: document.id, s3Key }, 'Document record created');

    boss = createBoss();
    await boss.start();
    await boss.createQueue('document-ingestion');

    const ingestionService = new IngestionService(tenantId);
    const jobId = await ingestionService.enqueueIngestion(boss, {
      documentId: document.id,
      tenantId,
      s3Key,
      mimeType,
      knowledgeBaseId,
    });

    await boss.stop({ graceful: false });
    boss = null;

    logger.info({ documentId: document.id, jobId }, 'Ingestion job enqueued');

    return NextResponse.json({ document, jobId }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Upload flow failed');

    if (boss) {
      try { await boss.stop({ graceful: false }); } catch { /* ignore */ }
    }

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
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
