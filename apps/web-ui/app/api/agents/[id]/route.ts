import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  updateAgentSchema,
  createLogger,
  TelegramAccountBindingService,
  TelegramAccountBindingError,
  type TelegramAccountBindingDb,
} from '@chatbot/shared';
import { AgentService, type AgentDb } from '@chatbot/agent-studio';
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
    const validatedBody = parsed.data;
    const db = getPrismaClient();

    const agent = await db.$transaction(async (tx) => {
      const service = new AgentService(tenantId, tx as unknown as AgentDb);
      const updated = await service.update(id, validatedBody);

      if (validatedBody.config && typeof validatedBody.config === 'object') {
        const config = validatedBody.config as { nodes?: Array<{ id: string; type: string; config?: Record<string, unknown> }> };
        const bindingService = new TelegramAccountBindingService(tx as unknown as TelegramAccountBindingDb);
        await bindingService.sync({ tenantId, agentId: id, nodes: config.nodes ?? [] });
      }

      return updated;
    });

    logger.info({ tenantId, agentId: id }, 'Agent updated via API');
    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof TelegramAccountBindingError) {
      const status = error.code === 'ACCOUNT_NOT_FOUND' ? 404 : error.code === 'MULTIPLE_TRIGGERS' ? 400 : 409;
      logger.warn({ error, code: error.code }, 'Agent save rejected by Telegram account binding sync');
      return NextResponse.json({ error: error.message }, { status });
    }
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
