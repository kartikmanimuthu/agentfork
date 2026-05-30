import { NextRequest } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, ApiKeyService, createApiKeySchema, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:api-keys');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    const db = getPrismaClient();
    const service = new ApiKeyService(tenantId, db);
    const keys = await service.findByAgentId(id, status);

    return new Response(JSON.stringify(keys), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to list API keys');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = createApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 }
      );
    }
    const validatedBody = parsed.data;
    const { name, dailyReqLimit, dailyTokenLimit, minuteReqLimit, scopes, expiresAt, webhookUrl, webhookSecret } = validatedBody;

    const db = getPrismaClient();
    const service = new ApiKeyService(tenantId, db);
    const result = await service.create({
      agentId: id,
      name,
      dailyReqLimit,
      dailyTokenLimit,
      minuteReqLimit,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      createdBy: userId,
    });

    // Update webhook fields if provided
    if (webhookUrl || webhookSecret) {
      const apiKey = result.apiKey as { id: string };
      await db.apiKey.update({
        where: { id: apiKey.id },
        data: {
          ...(webhookUrl !== undefined && { webhookUrl }),
          ...(webhookSecret !== undefined && { webhookSecret }),
        },
      });
    }

    logger.info({ tenantId, agentId: id, apiKeyId: (result.apiKey as { id: string }).id }, 'API key created');
    return new Response(JSON.stringify(result), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to create API key');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
