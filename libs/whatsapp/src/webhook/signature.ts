import { createHmac, timingSafeEqual } from 'crypto';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const expectedHash = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expected = `sha256=${expectedHash}`;

  if (expected.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
