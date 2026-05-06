import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { McpServerService, McpServerVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'McpServers', authOptions);
    if (authError) return authError;

    const { id, versionId } = await params;
    const db = getPrismaClient();

    const service = new McpServerService(tenantId, db as any);
    const existing = await service.findById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const versionService = new McpServerVersionService(db as any);
    const version = await versionService.findById(versionId);
    if (!version || version.mcpServerId !== id) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    const restored = await service.update(id, {
      config: version.config as any,
    });

    await versionService.create(
      id,
      version.config as any,
      `Restored from version ${version.version}`
    );

    return NextResponse.json(restored);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
