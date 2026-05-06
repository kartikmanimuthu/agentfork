import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const server = await service.findById(id);
    if (!server) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const connected = server.status === 'active';

    return NextResponse.json({
      connected,
      serverId: id,
      transport: server.transport,
      error: connected ? undefined : 'Server is inactive',
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { connected: false, error: 'Test failed' },
      { status: 200 }
    );
  }
}
