import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { LlmProviderService, ValidateInputSchema, createLogger, env } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:llm-providers:validate');

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;
    const body = await req.json().catch(() => ({}));
    logger.info(
      { tenantId, providerType: body.providerType, region: body.region, baseUrl: body.credentials?.baseUrl },
      'Received provider validation request',
    );

    const parsed = ValidateInputSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Validation schema rejected input');
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new LlmProviderService(tenantId);
    // Editing an existing provider: the form is never given the stored secrets,
    // so it can only submit the fields the operator retyped. Merge server-side
    // before discovery — otherwise changing only the base URL re-ran discovery
    // with no API key and failed, which is what made changing the model look
    // like it required re-entering every credential.
    const submitted = (parsed.data.credentials ?? {}) as Record<string, string>;
    const credentials = parsed.data.providerId
      ? await service.mergeStoredCredentials(parsed.data.providerId, submitted)
      : submitted;
    const discoveryInput =
      parsed.data.providerType === 'LITELLM'
        ? {
            ...parsed.data,
            credentials: {
              baseUrl: credentials.gatewayUrl ?? env.LITELLM_GATEWAY_URL,
              apiKey: credentials.masterKey ?? env.LITELLM_MASTER_KEY,
            },
          }
        : { ...parsed.data, credentials };
    const result = await service.validateAndDiscoverModels(discoveryInput, (providerType, credentials, region) =>
      createDiscovery(providerType as never).discover(credentials, region),
    );
    logger.info(
      { tenantId, providerType: parsed.data.providerType, modelCount: result.models?.length },
      'Provider validation succeeded',
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    logger.error({ error: message }, 'Provider validation failed');
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
