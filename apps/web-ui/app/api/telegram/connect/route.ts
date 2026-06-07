import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { TelegramBotApi } from '@chatbot/telegram';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('telegram-connect');

const connectSchema = z.object({
  botToken: z.string().min(1),
  name: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { botToken, name } = parsed.data;

    const api = new TelegramBotApi({ botToken });
    const me = await api.getMe().catch((error) => {
      logger.error({ error }, 'Failed to call getMe — invalid bot token');
      return null;
    });
    if (!me) return NextResponse.json({ error: 'Invalid bot token — could not reach Telegram API.' }, { status: 400 });

    const encryption = new EncryptionService();
    const encryptedToken = encryption.encrypt(botToken);
    const secretToken = crypto.randomUUID();

    const prisma = getPrismaClient();

    // Create the account first so we have a stable ID for the webhook URL
    const account = await (prisma as any).telegramAccount.create({
      data: {
        tenantId,
        botToken: encryptedToken,
        botName: name || me.first_name,
        botUsername: me.username ?? null,
        webhookSecret: secretToken,
        status: 'active',
      },
    });

    // Register webhook using the actual account ID — if this fails, clean up the record
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/telegram/${account.id}`;
    try {
      await api.setWebhook(webhookUrl, secretToken);
    } catch (error) {
      logger.error({ error, accountId: account.id }, 'Failed to set Telegram webhook — rolling back account');
      await (prisma as any).telegramAccount.delete({ where: { id: account.id } }).catch(() => {});
      return NextResponse.json({ error: 'Failed to register webhook with Telegram. Check your bot token.' }, { status: 502 });
    }

    await (prisma as any).telegramRouting.create({
      data: {
        accountId: account.id,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: null,
      },
    });

    logger.info({ tenantId, accountId: account.id, botUsername: me.username }, 'Telegram bot connected');

    return NextResponse.json({
      id: account.id,
      botName: account.botName,
      botUsername: account.botUsername,
      status: account.status,
    }, { status: 201 });

  } catch (error) {
    logger.error({ error }, 'Error connecting Telegram bot');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
