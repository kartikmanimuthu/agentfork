import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('telegram-routing');

const updateRoutingSchema = z.object({
  strategy: z.enum(['keyword', 'menu', 'ai_intent', 'time_based']),
  config: z.record(z.unknown()).default({}),
  fallbackAgentId: z.string().nullable().optional(),
  rules: z.array(z.object({
    agentId: z.string().min(1),
    priority: z.number().int().min(0),
    condition: z.record(z.unknown()),
    isActive: z.boolean().default(true),
  })).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).telegramAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const routing = await (prisma as any).telegramRouting.findUnique({
      where: { accountId: id },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    return NextResponse.json(routing);
  } catch (error) {
    logger.error({ error }, 'Error fetching routing config');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateRoutingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();

    const account = await (prisma as any).telegramAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const routing = await (prisma as any).telegramRouting.upsert({
      where: { accountId: id },
      update: {
        strategy: parsed.data.strategy,
        config: parsed.data.config,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
      create: {
        accountId: id,
        strategy: parsed.data.strategy,
        config: parsed.data.config,
        fallbackAgentId: parsed.data.fallbackAgentId ?? null,
      },
    });

    if (parsed.data.rules) {
      await (prisma as any).telegramRoutingRule.deleteMany({
        where: { routingId: routing.id },
      });

      await (prisma as any).telegramRoutingRule.createMany({
        data: parsed.data.rules.map((rule) => ({
          routingId: routing.id,
          agentId: rule.agentId,
          priority: rule.priority,
          condition: rule.condition,
          isActive: rule.isActive,
        })),
      });
    }

    const updated = await (prisma as any).telegramRouting.findUnique({
      where: { accountId: id },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    logger.info({ tenantId, accountId: id, strategy: parsed.data.strategy }, 'Routing config updated');

    return NextResponse.json(updated);
  } catch (error) {
    logger.error({ error }, 'Error updating routing config');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
