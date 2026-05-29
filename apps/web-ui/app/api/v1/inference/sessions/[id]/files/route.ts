import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, S3Service } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../lib/auth';

const logger = createLogger('api:inference:sessions:files');

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { tenantId, apiKeyId } = authResult.auth;

  try {
    const db = getPrismaClient();

    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId },
    });
    if (!session) {
      logger.warn({ tenantId, apiKeyId, sessionId }, 'File upload rejected — session not found');
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      logger.warn({ tenantId, apiKeyId, sessionId }, 'File upload attempted with no file in request');
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'No file provided' } },
        { status: 400 }
      );
    }

    logger.info(
      { tenantId, apiKeyId, sessionId, fileName: file.name, mimeType: file.type, size: file.size },
      'Session file upload started',
    );

    if (file.size > MAX_SIZE) {
      logger.warn(
        { tenantId, apiKeyId, sessionId, fileName: file.name, size: file.size, maxSize: MAX_SIZE },
        'File upload rejected — exceeds size limit',
      );
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'File exceeds 10MB limit' } },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      logger.warn(
        { tenantId, apiKeyId, sessionId, fileName: file.name, mimeType: file.type },
        'File upload rejected — unsupported MIME type',
      );
      return NextResponse.json(
        { error: { type: 'validation_error', message: `File type ${file.type} not allowed` } },
        { status: 400 }
      );
    }

    const s3 = new S3Service();
    const fileId = crypto.randomUUID();
    const key = `sdk-uploads/${tenantId}/${sessionId}/${fileId}-${file.name}`;

    logger.debug(
      { tenantId, sessionId, fileId, s3Key: key, mimeType: file.type },
      'Uploading file to S3',
    );

    const uploadStart = Date.now();
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.uploadBuffer(key, buffer, file.type);
    const url = await s3.getDownloadUrl(key);
    const uploadMs = Date.now() - uploadStart;

    logger.info(
      { tenantId, apiKeyId, sessionId, fileId, fileName: file.name, s3Key: key, mimeType: file.type, size: file.size, uploadMs },
      'Session file uploaded successfully',
    );

    return NextResponse.json({
      fileId,
      s3Key: key,
      url,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
    }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { tenantId, apiKeyId, sessionId, errorMessage: err.message, errorStack: err.stack },
      'Session file upload failed — internal error',
    );
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'File upload failed' } },
      { status: 500 }
    );
  }
}
