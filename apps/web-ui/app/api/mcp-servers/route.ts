import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? undefined;
    const transport = searchParams.get('transport') ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);

    const db = getPrismaClient();
    const service = new McpServerService(tenantId, db as any);
    const result = await service.findMany({
      status: status as any,
      transport: transport as any,
      search,
      page,
      pageSize,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'McpServers', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const server = await service.create(body);

    const versionService = new McpServerVersionService(db as any);
    await versionService.create(
      server.id,
      server.config as any,
      'Initial version'
    );

    return NextResponse.json(server, { status: 201 });
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
