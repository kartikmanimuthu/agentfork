import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  TranscriptionApiKeyService,
  createTranscriptionApiKeySchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:api-keys');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionApiKey', authOptions);
    if (authError) return authError;

    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    const jobConfigId = req.nextUrl.searchParams.get('jobConfigId') ?? undefined;
    const keys = await new TranscriptionApiKeyService(tenantId).list({ status, jobConfigId });
    // Never leak the hash; expose only safe display fields.
    const safe = keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      status: k.status,
      jobConfigId: k.jobConfigId,
      modelId: k.modelId,
      scopes: k.scopes,
      dailyReqLimit: k.dailyReqLimit,
      dailyMinutesLimit: k.dailyMinutesLimit,
      minuteReqLimit: k.minuteReqLimit,
      webhookUrl: k.webhookUrl,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
    }));
    return NextResponse.json(safe);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list transcription API keys');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'TranscriptionApiKey', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = createTranscriptionApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const { expiresAt, ...rest } = parsed.data;

    const service = new TranscriptionApiKeyService(tenantId);
    const { rawKey, apiKey } = await service.create({
      ...rest,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      createdBy: userId,
    });

    logger.info({ tenantId, apiKeyId: apiKey.id }, 'Transcription API key created');
    // rawKey is returned exactly once, on creation.
    return NextResponse.json(
      { rawKey, apiKey: { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to create transcription API key');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
