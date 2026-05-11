import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { DocumentService, IngestionService, createDocumentSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { createBoss } from '@/lib/boss';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    const body = await req.json();
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const { dataSourceId: sourceId, fileName, mimeType, sizeBytes } = parsed.data;

    const docService = new DocumentService(tenantId);

    // Get pre-signed upload URL
    const { uploadUrl, s3Key } = await docService.getUploadUrl(sourceId, fileName, mimeType);

    // Create document record in PENDING state
    const document = await docService.create({
      dataSourceId: sourceId,
      sourceKey: s3Key,
      fileName,
      mimeType,
      sizeBytes,
    });

    // Enqueue ingestion job (fires after client uploads to S3)
    const ingestionService = new IngestionService(tenantId);
    const boss = createBoss();
    await boss.start();
    await ingestionService.enqueueIngestion(boss, {
      documentId: document.id,
      tenantId,
      s3Key,
      mimeType,
      knowledgeBaseId,
    });
    await boss.stop({ graceful: false });

    return NextResponse.json({ uploadUrl, document }, { status: 201 });
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
