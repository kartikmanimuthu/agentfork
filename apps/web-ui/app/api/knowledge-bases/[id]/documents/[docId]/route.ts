import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { DocumentService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('api:knowledge-bases:document-detail');

const patchDocumentSchema = z.object({
  status: z.enum(['FAILED']),
  errorMessage: z.string().max(2000).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { docId } = await params;
    logger.info({ tenantId, docId }, 'Get document request');

    const service = new DocumentService(tenantId);
    const doc = await service.get(docId);

    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, docId }, 'Get document completed');
    return NextResponse.json(doc);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Get document failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { docId } = await params;
    const body = await parseJson(req, patchDocumentSchema);
    logger.info({ tenantId, docId, status: body.status }, 'Patch document request');

    const service = new DocumentService(tenantId);
    const updated = await service.update(docId, body);

    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, docId, status: body.status }, 'Document patched');
    return NextResponse.json(updated);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Patch document failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { docId } = await params;
    logger.info({ tenantId, docId }, 'Delete document request');

    const service = new DocumentService(tenantId);
    const deleted = await service.delete(docId);

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, docId }, 'Document deleted');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Delete document failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
