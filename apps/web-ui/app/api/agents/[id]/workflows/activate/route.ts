import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, AgentWorkflowService } from '@chatbot/shared';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:workflows:activate');
const bodySchema = z.object({ isActive: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const svc = new AgentWorkflowService(tenantId, getPrismaClient() as any);
    await svc.setActive(id, parsed.data.isActive);
    logger.info({ tenantId, agentId: id, isActive: parsed.data.isActive }, 'Workflow activation toggled');
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    if (error instanceof Error && error.message.includes('Unauthorized')) return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    if (error instanceof Error && error.message.includes('No workflow')) return NextResponse.json({ error: error.message }, { status: 404 });
    logger.error({ error }, 'Failed to toggle activation');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
