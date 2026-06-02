import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:mcp-servers[id]:tools');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const server = await db.mcpServer.findFirst({ where: { id, tenantId } });
    if (!server) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (server.status !== 'active') {
      logger.info({ tenantId, mcpServerId: id, status: server.status }, 'Server not active — returning empty tool list');
      return NextResponse.json({ tools: [], error: 'Server is inactive' });
    }

    const { McpClientService } = await import('@chatbot/agent-studio/server');
    const mcpClient = new McpClientService();

    try {
      const discovered = await mcpClient.discoverTools(server.config as any);
      logger.info({ tenantId, mcpServerId: id, toolCount: discovered.length }, 'Tools discovered');
      return NextResponse.json({
        tools: discovered.map((t) => ({ name: t.name, description: t.description })),
      });
    } catch (connErr) {
      logger.warn({ tenantId, mcpServerId: id, err: connErr }, 'Failed to connect to MCP server for tool discovery');
      return NextResponse.json({ tools: [], error: 'Could not connect to server' });
    } finally {
      await mcpClient.disconnect().catch(() => {});
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const { id } = await params;
    logger.error({ error, mcpServerId: id }, 'MCP tools discovery route failed');
    return NextResponse.json({ tools: [], error: 'Internal server error' }, { status: 500 });
  }
}
