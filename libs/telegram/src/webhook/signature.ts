import { timingSafeEqual } from 'crypto';

export function validateWebhookSecret(
  headerSecret: string | null,
  configuredSecret: string,
): boolean {
  if (!headerSecret || !configuredSecret) {
    return false;
  }

  const expected = Buffer.from(configuredSecret);
  const received = Buffer.from(headerSecret);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}
