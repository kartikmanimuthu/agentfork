import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, updateMcpServerSchema, createLogger } from '@chatbot/shared';
import { McpServerService } from '@chatbot/agent-studio/services/mcp-server-service';
import { McpServerVersionService } from '@chatbot/agent-studio/services/mcp-server-version-service';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:mcp-servers:id');

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) return null;
  return session;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await params;
    const service = new McpServerService(session.studio.tenantId, getPrismaClient() as any);
    const server = await service.findByIdWithVersions(id);
    if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(server);
  } catch (error) {
    logger.error({ error }, 'Failed to get MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    const tenantId = session.studio.tenantId;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateMcpServerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const db = getPrismaClient();
    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const server = await service.update(id, parsed.data as any);

    const versionService = new McpServerVersionService(db as any);
    await versionService.create(id, server.config as any, (body as { changeNotes?: string }).changeNotes ?? undefined);

    logger.info({ tenantId, mcpServerId: id }, 'MCP server updated via API');
    return NextResponse.json(server);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'MCP server with this name already exists' }, { status: 409 });
    }
    logger.error({ error }, 'Failed to update MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await params;
    const service = new McpServerService(session.studio.tenantId, getPrismaClient() as any);
    const existing = await service.findById(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await service.delete(id);
    logger.info({ tenantId: session.studio.tenantId, mcpServerId: id }, 'MCP server deleted via API');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error({ error }, 'Failed to delete MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
