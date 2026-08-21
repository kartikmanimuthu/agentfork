import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  TranscriptionModelService,
  validateTranscriptionModelSchema,
  createLogger,
  env,
} from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models:validate');

/** Validate an ASR endpoint and list its models (scan) without persisting. */
export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = validateTranscriptionModelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 200 });
    }

    const service = new TranscriptionModelService(tenantId);
    const discoveryInput =
      parsed.data.providerType === 'LITELLM'
        ? {
            ...parsed.data,
            credentials: {
              baseUrl: parsed.data.credentials?.gatewayUrl ?? env.LITELLM_GATEWAY_URL ?? '',
              apiKey: parsed.data.credentials?.masterKey ?? env.LITELLM_MASTER_KEY ?? '',
            },
          }
        : parsed.data;
    try {
      const result = await service.validateAndDiscoverModels(discoveryInput, (providerType, credentials, region) =>
        createDiscovery(providerType as never).discover(credentials, region)
      );
      return NextResponse.json(result);
    } catch (discoverErr) {
      // Surface discovery failures as 200 with success:false so the UI can show them.
      const msg = discoverErr instanceof Error ? discoverErr.message : 'Discovery failed';
      logger.warn({ tenantId, providerType: parsed.data.providerType, err: msg }, 'Transcription model discovery failed');
      return NextResponse.json({ success: false, error: msg }, { status: 200 });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Validate transcription model failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
