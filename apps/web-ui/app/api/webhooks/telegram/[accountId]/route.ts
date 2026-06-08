import { NextRequest, NextResponse } from 'next/server';
import { validateWebhookSecret, parseWebhookBody, createMessageProcessor } from '@chatbot/telegram';
import { getPrismaClient, createLogger } from '@chatbot/shared';

const logger = createLogger('telegram-webhook');

export async function POST(
  req: NextRequest,
  { params }: { params: { accountId: string } },
): Promise<NextResponse> {
  try {
    const { accountId } = params;

    const rawBody = await req.text();
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token') ?? '';

    const prisma = getPrismaClient();
    const account = await (prisma as any).telegramAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      logger.warn({ accountId }, 'Telegram account not found');
      return NextResponse.json({ status: 'ok' });
    }

    if (!validateWebhookSecret(secretHeader, account.webhookSecret)) {
      logger.warn({ accountId }, 'Invalid webhook secret');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = JSON.parse(rawBody);
    const event = parseWebhookBody(payload);

    if (!event) {
      return NextResponse.json({ status: 'ok' });
    }

    const processor = createMessageProcessor();

    const processingPromise = processor.processMessageEvent({ ...event, accountId }).catch(
      (error) => logger.error({ error, accountId }, 'Failed to process Telegram event'),
    );

    processingPromise.catch((err) => logger.error({ err }, 'Background processing failed'));

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error({ error }, 'Webhook handler error');
    return NextResponse.json({ status: 'ok' });
  }
}
