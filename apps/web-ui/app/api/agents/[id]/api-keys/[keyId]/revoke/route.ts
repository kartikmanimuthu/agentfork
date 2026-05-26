import { NextRequest } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ApiKeyService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:api-keys[keyId]:revoke');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { keyId } = await params;
    const db = getPrismaClient();
    const service = new ApiKeyService(tenantId, db);
    await service.revoke(keyId);

    logger.info({ tenantId, keyId }, 'API key revoked');
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error, keyId: (await params).keyId }, 'Failed to revoke API key');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
