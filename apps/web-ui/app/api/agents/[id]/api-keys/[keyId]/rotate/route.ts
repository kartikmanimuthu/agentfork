import { NextRequest } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ApiKeyService, rotateApiKeySchema, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:api-keys[keyId]:rotate');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { keyId } = await params;
    const body = await req.json();
    const parsed = rotateApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 }
      );
    }
    const { gracePeriodHours } = parsed.data;

    const db = getPrismaClient();
    const service = new ApiKeyService(tenantId, db);
    const result = await service.rotate(keyId, gracePeriodHours);

    logger.info({ tenantId, keyId }, 'API key rotated');
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error, keyId: (await params).keyId }, 'Failed to rotate API key');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
