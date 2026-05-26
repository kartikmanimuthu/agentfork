import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { McpServerService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:mcp-servers[id]:test');

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

    logger.info({ tenantId, mcpServerId: id, connected, transport: server.transport }, 'MCP server test executed');
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
    logger.error({ error, mcpServerId: (await params).id }, 'MCP server test failed');
    return NextResponse.json(
      { connected: false, error: 'Test failed' },
      { status: 200 }
    );
  }
}
