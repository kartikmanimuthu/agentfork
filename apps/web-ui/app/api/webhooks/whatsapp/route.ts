import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, parseWebhookPayload, parseNetcoreWebhookPayload, parseNetcoreDeliveryStatus, createMessageProcessor, whatsappEnv } from '@chatbot/whatsapp';
import type { NetcoreDeliveryStatus } from '@chatbot/whatsapp';
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

  // Temporary: capture full query params + headers to learn the Netcore verification contract (no known shape yet)
  logger.warn(
    { mode, token, query: Object.fromEntries(searchParams.entries()), headers: Object.fromEntries(req.headers.entries()) },
    'Webhook verification failed',
  );
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawBody: string | undefined;
  try {
    rawBody = await req.text();
    const payload = JSON.parse(rawBody);

    let events;

    if (payload.object === 'whatsapp_business_account') {
      const signature = req.headers.get('x-hub-signature-256') ?? '';

      if (!verifyWebhookSignature(rawBody, signature, whatsappEnv.META_APP_SECRET)) {
        logger.warn(
          { headers: Object.fromEntries(req.headers.entries()), rawBody },
          'Invalid webhook signature',
        );
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }

      events = parseWebhookPayload(payload);
    } else if (Array.isArray(payload.incoming_message)) {
      events = parseNetcoreWebhookPayload(payload);
    } else if (Array.isArray(payload.delivery_status)) {
      logger.info(
        { count: payload.delivery_status.length, statuses: payload.delivery_status.map((d: NetcoreDeliveryStatus) => ({ id: d.ncmessage_id, status: d.status })) },
        'Netcore delivery_status event received',
      );
      events = parseNetcoreDeliveryStatus(payload);
    } else {
      logger.warn({ rawBody }, 'Unrecognized webhook payload shape');
      return NextResponse.json({ status: 'ok' });
    }

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
    logger.error({ error, rawBody }, 'Webhook handler error');
    return NextResponse.json({ status: 'ok' });
  }
}
