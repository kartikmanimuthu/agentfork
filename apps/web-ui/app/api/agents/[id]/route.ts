import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, updateAgentSchema, validateAgentConfig, createLogger } from '@chatbot/shared';
import { AgentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    const agent = await service.findById(id);

    if (!agent) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    logger.error({ error }, 'Failed to get agent');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    // Validate + normalize the guardrails config so malformed shapes are rejected
    // (400) and valid-but-partial configs are deep-merged over full defaults
    // before storage (Zod v4 cascade gap would otherwise leave nested guards empty).
    if (parsed.success && parsed.data.config !== undefined) {
      const cfgCheck = validateAgentConfig(parsed.data.config);
      if (!cfgCheck.success) {
        return NextResponse.json(
          { error: 'Invalid guardrails config', issues: cfgCheck.error.issues },
          { status: 400 },
        );
      }
      // Store the normalized config so the DB never holds a partial guardrails policy.
      parsed.data.config = cfgCheck.data;
    }
    const validatedBody = parsed.data;
    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    const agent = await service.update(id, validatedBody);

    logger.info({ tenantId, agentId: id }, 'Agent updated via API');
    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to update agent');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    await service.delete(id);

    logger.info({ tenantId, agentId: id }, 'Agent deleted via API');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to delete agent');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
