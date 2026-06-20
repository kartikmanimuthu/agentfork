import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createAgentSchema, validateAgentConfig, createLogger } from '@chatbot/shared';
import { AgentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? undefined;
    const type = searchParams.get('type') ?? undefined;
    const search = searchParams.get('search') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);

    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    const result = await service.findMany({ status: status as any, type: type as any, search, page, pageSize });

    return NextResponse.json(result);
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
    logger.error({ error }, 'Failed to list agents');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'Agent', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    // Validate + normalize the guardrails config so malformed shapes are rejected
    // (400) and valid-but-partial configs are deep-merged over full defaults
    // before storage (Zod v4 cascade gap would otherwise leave nested guards
    // empty → guardrails silently non-functional until a designer PUT normalizes).
    // `createAgentSchema.config = z.any()` (no `.optional()`), so `parsed.data.config`
    // is always present on a successful create — guard accordingly.
    const cfgCheck = validateAgentConfig(parsed.data.config);
    if (!cfgCheck.success) {
      return NextResponse.json(
        { error: 'Invalid guardrails config', issues: cfgCheck.error.issues },
        { status: 400 },
      );
    }
    // Store the normalized config so the DB never holds a partial guardrails policy.
    parsed.data.config = cfgCheck.data;
    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    const agent = await service.create({ ...parsed.data, tenantId });

    logger.info({ tenantId, agentId: (agent as { id: string }).id }, 'Agent created via API');
    return NextResponse.json(agent, { status: 201 });
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
    logger.error({ error }, 'Failed to create agent');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
