import { createHmac, timingSafeEqual } from 'crypto';

export function validateWebhookSecret(
  headerSecret: string | null,
  configuredSecret: string,
): boolean {
  if (!headerSecret || !configuredSecret) {
    return false;
  }

  const expected = createHmac('sha256', configuredSecret)
    .update('telegram-webhook')
    .digest('hex');

  if (expected.length !== headerSecret.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(headerSecret));
}
