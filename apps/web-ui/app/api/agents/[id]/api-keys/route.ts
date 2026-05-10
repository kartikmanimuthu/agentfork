import { NextRequest } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, ApiKeyService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const authError = await authorize('read', 'Agent', authOptions);
  if (authError) return authError;

  const { id } = await params;
  const db = getPrismaClient();
  const service = new ApiKeyService(tenantId, db);
  const keys = await service.findByAgentId(id);

  return new Response(JSON.stringify(keys), { status: 200 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const userId = await getSessionUserId(authOptions);
  const authError = await authorize('create', 'Agent', authOptions);
  if (authError) return authError;

  const { id } = await params;
  const body = await req.json();
  const { name, dailyReqLimit, dailyTokenLimit, minuteReqLimit, scopes, expiresAt, webhookUrl, webhookSecret } = body;

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

  return new Response(JSON.stringify(result), { status: 201 });
}
