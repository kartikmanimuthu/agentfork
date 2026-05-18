import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, createMcpServerVersionSchema } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:mcp-servers[id]:versions');

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
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionService = new McpServerVersionService(db as any);
    const versions = await versionService.findByMcpServerId(id);

    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, mcpServerId: (await params).id }, 'Failed to list MCP server versions');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = createMcpServerVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const { changeNotes } = parsed.data;
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionService = new McpServerVersionService(db as any);
    const version = await versionService.create(
      id,
      existing.config as any,
      changeNotes
    );

    logger.info({ tenantId, mcpServerId: id, versionId: (version as { id: string }).id }, 'MCP server version created');
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, mcpServerId: (await params).id }, 'Failed to create MCP server version');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
