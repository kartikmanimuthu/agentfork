import { NextRequest } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ApiKeyService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const authError = await authorize('update', 'Agent', authOptions);
  if (authError) return authError;

  const { keyId } = await params;
  const db = getPrismaClient();
  const service = new ApiKeyService(tenantId, db);
  await service.revoke(keyId);

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
