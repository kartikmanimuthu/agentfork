import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const agent = await (db as any).agent.findFirst({
      where: { id, tenantId },
      include: {
        mcpServers: {
          include: { mcpServer: true },
        },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const servers = agent.mcpServers.map((ams: any) => ams.mcpServer);
    return NextResponse.json(servers);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { mcpServerId } = await req.json();
    const db = getPrismaClient();

    const agent = await (db as any).agent.findFirst({
      where: { id, tenantId },
    });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const server = await (db as any).mcpServer.findFirst({
      where: { id: mcpServerId, tenantId },
    });
    if (!server) {
      return NextResponse.json(
        { error: 'MCP server not found' },
        { status: 404 }
      );
    }

    await (db as any).agentMcpServer.create({
      data: { agentId: id, mcpServerId },
    });

    const currentIds = (agent.config?.mcpServerIds ?? []) as string[];
    if (!currentIds.includes(mcpServerId)) {
      await (db as any).agent.update({
        where: { id },
        data: {
          config: {
            ...(agent.config as Record<string, unknown> ?? {}),
            mcpServerIds: [...currentIds, mcpServerId],
          },
        },
      });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'MCP server already attached' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
