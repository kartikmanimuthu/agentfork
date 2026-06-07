import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('telegram-accounts');

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const prisma = getPrismaClient();
    const accounts = await (prisma as any).telegramAccount.findMany({
      where: { tenantId, status: { not: 'disconnected' } },
      select: {
        id: true,
        botName: true,
        botUsername: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(accounts);
  } catch (error) {
    logger.error({ error }, 'Error listing Telegram accounts');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
