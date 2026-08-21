import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, TranscriptionApiKeyService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:api-keys:webhook-secret');

/** GET — returns whether a webhook secret is configured; never the raw value. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionApiKey', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const status = await new TranscriptionApiKeyService(tenantId).getWebhookSecretStatus(id);
    return NextResponse.json(status);
  } catch (error) {
    logger.error({ error }, 'Failed to get webhook secret status');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST — rotates (or generates) the webhook signing secret. Returns the raw secret ONCE. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionApiKey', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const result = await new TranscriptionApiKeyService(tenantId).rotateWebhookSecret(id);
    logger.info({ tenantId, apiKeyId: id }, 'Webhook secret rotated via API');
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to rotate webhook secret');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
