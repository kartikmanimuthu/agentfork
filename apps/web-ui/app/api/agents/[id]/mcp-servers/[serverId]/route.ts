import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:mcp-servers[serverId]');

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; serverId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id, serverId } = await params;
    const db = getPrismaClient();

    const agent = await (db as any).agent.findFirst({
      where: { id, tenantId },
    });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    await (db as any).agentMcpServer.deleteMany({
      where: { agentId: id, mcpServerId: serverId },
    });

    const currentIds = (agent.config?.mcpServerIds ?? []) as string[];
    if (currentIds.includes(serverId)) {
      await (db as any).agent.update({
        where: { id },
        data: {
          config: {
            ...(agent.config as Record<string, unknown> ?? {}),
            mcpServerIds: currentIds.filter((sid) => sid !== serverId),
          },
        },
      });
    }

    logger.info({ tenantId, agentId: id, mcpServerId: serverId }, 'MCP server detached from agent');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id, serverId: (await params).serverId }, 'Failed to detach MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
