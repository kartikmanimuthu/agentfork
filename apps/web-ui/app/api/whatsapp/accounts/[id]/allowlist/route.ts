import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-allowlist');

const updateAllowlistSchema = z.object({
  restrictToAllowlist: z.boolean(),
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

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const contacts = await (prisma as any).whatsAppAllowedContact.findMany({
      where: { accountId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ restrictToAllowlist: account.restrictToAllowlist, contacts });
  } catch (error) {
    logger.error({ error }, 'Error fetching allowlist');
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
    const parsed = updateAllowlistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await (prisma as any).whatsAppAccount.update({
      where: { id },
      data: { restrictToAllowlist: parsed.data.restrictToAllowlist },
    });

    logger.info({ tenantId, accountId: id, restrictToAllowlist: parsed.data.restrictToAllowlist }, 'Updated WhatsApp allowlist mode');

    return NextResponse.json({ restrictToAllowlist: parsed.data.restrictToAllowlist });
  } catch (error) {
    logger.error({ error }, 'Error updating allowlist mode');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
