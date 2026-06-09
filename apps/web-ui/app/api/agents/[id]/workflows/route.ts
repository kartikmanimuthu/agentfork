import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, AgentWorkflowService, workflowDefinitionSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:workflows');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;
    const { id } = await params;
    const svc = new AgentWorkflowService(tenantId, getPrismaClient() as any);
    const wf = await svc.getByAgent(id);
    return NextResponse.json(wf);
  } catch (error) {
    return handleErr(error, logger, 'get workflow');
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;
    const { id } = await params;
    const parsed = workflowDefinitionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid workflow' }, { status: 400 });
    }
    const svc = new AgentWorkflowService(tenantId, getPrismaClient() as any);
    const wf = await svc.upsert(id, parsed.data);
    logger.info({ tenantId, agentId: id }, 'Workflow saved');
    return NextResponse.json(wf);
  } catch (error) {
    return handleErr(error, logger, 'save workflow');
  }
}

function handleErr(error: unknown, log: ReturnType<typeof createLogger>, what: string) {
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && error.message.includes('Unauthorized')) return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
  log.error({ error }, `Failed to ${what}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
