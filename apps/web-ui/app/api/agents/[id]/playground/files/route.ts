import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, S3Service, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:playground:files');

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
  const authError = await authorize('create', 'AgentExecution', authOptions);
  if (authError) return authError;

  const tenantId = await getSessionTenantId(authOptions);
  const userId = await getSessionUserId(authOptions);
  const { id: agentId } = await params;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      logger.warn({ tenantId, userId, agentId }, 'File upload attempted with no file in request');
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'No file provided' } },
        { status: 400 }
      );
    }

    logger.info(
      { tenantId, userId, agentId, fileName: file.name, mimeType: file.type, size: file.size },
      'Playground file upload started',
    );

    if (file.size > MAX_SIZE) {
      logger.warn(
        { tenantId, userId, agentId, fileName: file.name, size: file.size, maxSize: MAX_SIZE },
        'File upload rejected — exceeds size limit',
      );
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'File exceeds 10MB limit' } },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      logger.warn(
        { tenantId, userId, agentId, fileName: file.name, mimeType: file.type, allowedTypes: ALLOWED_TYPES },
        'File upload rejected — unsupported MIME type',
      );
      return NextResponse.json(
        { error: { type: 'validation_error', message: `File type ${file.type} not allowed` } },
        { status: 400 }
      );
    }

    const s3 = new S3Service();
    const fileId = crypto.randomUUID();
    const key = `playground-uploads/${tenantId}/${agentId}/${fileId}-${file.name}`;

    logger.debug(
      { tenantId, agentId, fileId, s3Key: key, mimeType: file.type, size: file.size },
      'Uploading file to S3',
    );

    const uploadStart = Date.now();
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.uploadBuffer(key, buffer, file.type);
    const uploadMs = Date.now() - uploadStart;

    logger.info(
      { tenantId, userId, agentId, fileId, fileName: file.name, s3Key: key, mimeType: file.type, size: file.size, uploadMs },
      'Playground file uploaded successfully',
    );

    return NextResponse.json({
      fileId,
      s3Key: key,
      mimeType: file.type,
      fileName: file.name,
      size: file.size,
    }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { tenantId, userId, agentId, errorMessage: err.message, errorStack: err.stack },
      'Playground file upload failed — internal error',
    );
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'File upload failed' } },
      { status: 500 }
    );
  }
}
