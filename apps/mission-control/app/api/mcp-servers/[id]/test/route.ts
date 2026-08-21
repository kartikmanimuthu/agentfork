import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { McpServerService } from '@chatbot/agent-studio/services/mcp-server-service';
import { McpClientService } from '@chatbot/agent-studio/services/mcp-client.service';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:mcp-servers:test');

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const { id } = await params;
    const service = new McpServerService(session.studio.tenantId, getPrismaClient() as any);
    const server = await service.findById(id);
    if (!server) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const client = new McpClientService();
    try {
      const tools = await client.discoverTools(server.config as any);
      return NextResponse.json({ success: true, connected: true, toolCount: tools.length, tools: tools.map((t) => t.name) });
    } catch (error: any) {
      return NextResponse.json({ success: true, connected: false, error: error.message || 'Connection failed' });
    } finally {
      await client.disconnect().catch(() => {});
    }
  } catch (error) {
    logger.error({ error }, 'MCP server test failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
