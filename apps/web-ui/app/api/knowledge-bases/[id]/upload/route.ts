import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { DocumentService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
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
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { dataSourceId: sourceId, fileName, mimeType, sizeBytes } = await parseJson(req, uploadRequestSchema);

    const docService = new DocumentService(tenantId);
    const { uploadUrl, s3Key } = await docService.getUploadUrl(sourceId, fileName, mimeType);

    const document = await docService.create({
      dataSourceId: sourceId,
      sourceKey: s3Key,
      fileName,
      mimeType,
      sizeBytes,
    });

    logger.info({ documentId: document.id, s3Key }, 'Document record created, returning upload URL');

    return NextResponse.json({ uploadUrl, document }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Upload flow failed');

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
