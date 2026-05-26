import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('whatsapp-accounts');

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TenantConfig', authOptions);
    if (authError) return authError;

    const prisma = getPrismaClient();
    const accounts = await (prisma as any).whatsAppAccount.findMany({
      where: { tenantId, status: { not: 'disconnected' } },
      select: {
        id: true,
        phoneNumberId: true,
        displayPhone: true,
        displayName: true,
        status: true,
        qualityRating: true,
        messagingLimit: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(accounts);
  } catch (error) {
    logger.error({ error }, 'Error listing WhatsApp accounts');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
