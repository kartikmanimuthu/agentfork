import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, updateMcpServerSchema, createLogger } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:mcp-servers[id]');

export async function GET(
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
    const server = await service.findByIdWithVersions(id);

    if (!server) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(server);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to get MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateMcpServerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const server = await service.update(id, parsed.data as any);

    const versionService = new McpServerVersionService(db as any);
    await versionService.create(
      id,
      server.config as any,
      body.changeNotes ?? undefined
    );

    logger.info({ tenantId, mcpServerId: id }, 'MCP server updated via API');
    return NextResponse.json(server);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'MCP server with this name already exists' },
        { status: 409 }
      );
    }
    logger.error({ error, mcpServerId: (await params).id }, 'Failed to update MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new McpServerService(tenantId, db as any);

    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await service.delete(id);
    logger.info({ tenantId, mcpServerId: id }, 'MCP server deleted via API');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, mcpServerId: (await params).id }, 'Failed to delete MCP server');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
