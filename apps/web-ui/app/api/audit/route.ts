import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createAuditLogRepository, getTenantClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const eventType = searchParams.get('eventType') ?? undefined;
    const severity = searchParams.get('severity') ?? undefined;

    const db = getTenantClient(tenantId);
    const repo = createAuditLogRepository(db);
    const result = await repo.findAll({ eventType, severity }, { limit, offset });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
