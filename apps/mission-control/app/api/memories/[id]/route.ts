import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { getMemoryService } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:memories:id');

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) return null;
  return session;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });

    const { id } = await params;
    const memory = await getPrismaClient().clawMemory.findFirst({ where: { id, tenantId: session.studio.tenantId } });
    if (!memory) return NextResponse.json({ success: false, error: 'Memory not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: memory });
  } catch (error) {
    logger.error({ error }, 'Failed to get memory');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const tenantId = session.studio.tenantId;

    const { id } = await params;
    const db = getPrismaClient();
    const existing = await db.clawMemory.findFirst({ where: { id, tenantId } });
    if (!existing) return NextResponse.json({ success: false, error: 'Memory not found' }, { status: 404 });

    await getMemoryService().deleteMemory(tenantId, id);
    logger.info({ tenantId, memoryId: id }, 'Memory deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete memory');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
