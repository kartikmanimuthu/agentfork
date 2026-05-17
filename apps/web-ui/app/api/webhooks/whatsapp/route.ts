import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, parseWebhookPayload, createMessageProcessor, whatsappEnv } from '@chatbot/whatsapp';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('whatsapp-webhook');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === whatsappEnv.META_WEBHOOK_VERIFY_TOKEN) {
    logger.info('Webhook verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  logger.warn({ mode, token }, 'Webhook verification failed');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256') ?? '';

    if (!verifyWebhookSignature(rawBody, signature, whatsappEnv.META_APP_SECRET)) {
      logger.warn('Invalid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const events = parseWebhookPayload(payload);

    if (events.length === 0) {
      return NextResponse.json({ status: 'ok' });
    }

    const processingPromise = (async () => {
      const processor = createMessageProcessor();

      for (const event of events) {
        try {
          switch (event.type) {
            case 'message':
              await processor.processMessageEvent(event);
              break;
            case 'status':
              await processor.processStatusEvent(event);
              break;
            case 'error':
              logger.error({ error: event.error, phoneNumberId: event.phoneNumberId }, 'WhatsApp error event');
              break;
          }
        } catch (error) {
          logger.error({ error, eventType: event.type }, 'Failed to process WhatsApp event');
        }
      }
    })();

    processingPromise.catch((err) => logger.error({ err }, 'Background processing failed'));

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error({ error }, 'Webhook handler error');
    return NextResponse.json({ status: 'ok' });
  }
}
