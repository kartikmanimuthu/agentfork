import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('telegram-routing');

const routingSchema = z.object({
  accountId: z.string().min(1),
  graphId: z.string().min(1),
  rules: z.array(z.object({
    condition: z.record(z.unknown()),
    priority: z.number().default(0),
  })).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = routingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();

    const routing = await (prisma as any).telegramRouting.upsert({
      where: { accountId: parsed.data.accountId },
      update: {
        strategy: 'keyword',
        config: {},
        fallbackAgentId: parsed.data.graphId,
      },
      create: {
        accountId: parsed.data.accountId,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: parsed.data.graphId,
      },
    });

    if (parsed.data.rules) {
      await (prisma as any).telegramRoutingRule.deleteMany({
        where: { routingId: routing.id },
      });

      await (prisma as any).telegramRoutingRule.createMany({
        data: parsed.data.rules.map((rule) => ({
          routingId: routing.id,
          agentId: parsed.data.graphId,
          priority: rule.priority,
          condition: rule.condition,
          isActive: true,
        })),
      });
    }

    logger.info({ tenantId, accountId: parsed.data.accountId, graphId: parsed.data.graphId }, 'Telegram routing updated');

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error({ error }, 'Error updating Telegram routing');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
