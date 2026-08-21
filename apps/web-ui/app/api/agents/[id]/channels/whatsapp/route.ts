import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('api:agent-channels-whatsapp');

const connectSchema = z.object({
  accountId: z.string().min(1),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id: agentId } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { tenantId, agentId },
      select: { id: true, displayName: true, displayPhone: true, provider: true },
    });

    logger.info({ tenantId, agentId }, 'Fetched WhatsApp channel binding');
    return NextResponse.json({ account: account ?? null });
  } catch (error) {
    logger.error({ error }, 'Error fetching WhatsApp channel binding');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id: agentId } = await params;
    const body = await req.json();
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const prisma = getPrismaClient();

    const agent = await (prisma as any).agent.findFirst({
      where: { id: agentId, tenantId },
      select: { id: true },
    });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id: parsed.data.accountId, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const updated = await (prisma as any).$transaction(async (tx: any) => {
      await tx.whatsAppAccount.updateMany({
        where: { tenantId, agentId },
        data: { agentId: null },
      });
      return tx.whatsAppAccount.update({
        where: { id: parsed.data.accountId },
        data: { agentId },
        select: { id: true, displayName: true, displayPhone: true, provider: true },
      });
    });

    logger.info({ tenantId, agentId, accountId: parsed.data.accountId }, 'WhatsApp channel connected');
    return NextResponse.json({ account: updated });
  } catch (error) {
    logger.error({ error }, 'Error connecting WhatsApp channel');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id: agentId } = await params;
    const prisma = getPrismaClient();

    await (prisma as any).whatsAppAccount.updateMany({
      where: { tenantId, agentId },
      data: { agentId: null },
    });

    logger.info({ tenantId, agentId }, 'WhatsApp channel disconnected');
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ error }, 'Error disconnecting WhatsApp channel');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
