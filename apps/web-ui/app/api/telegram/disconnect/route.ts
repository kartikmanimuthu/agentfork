import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { TelegramBotApi } from '@chatbot/telegram';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('telegram-disconnect');

const disconnectSchema = z.object({
  accountId: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = disconnectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).telegramAccount.findFirst({
      where: { id: parsed.data.accountId, tenantId },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const encryption = new EncryptionService();
    const botToken = encryption.decrypt(account.botToken);

    try {
      const api = new TelegramBotApi({ botToken });
      await api.deleteWebhook();
    } catch (error) {
      logger.warn({ error, accountId: account.id }, 'Failed to delete Telegram webhook');
    }

    await (prisma as any).telegramAccount.delete({
      where: { id: account.id },
    });

    logger.info({ tenantId, accountId: account.id }, 'Telegram bot disconnected');

    return NextResponse.json({ status: 'disconnected' });
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Telegram bot');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
