import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from './signature';
import { createHmac } from 'crypto';

describe('verifyWebhookSignature', () => {
  const appSecret = 'test-app-secret';

  function sign(body: string, secret: string): string {
    const hmac = createHmac('sha256', secret);
    hmac.update(body);
    return `sha256=${hmac.digest('hex')}`;
  }

  it('returns true for valid signature', () => {
    const body = '{"entry":[]}';
    const signature = sign(body, appSecret);
    expect(verifyWebhookSignature(body, signature, appSecret)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    const body = '{"entry":[]}';
    const signature = 'sha256=invalid';
    expect(verifyWebhookSignature(body, signature, appSecret)).toBe(false);
  });

  it('returns false for missing signature', () => {
    const body = '{"entry":[]}';
    expect(verifyWebhookSignature(body, '', appSecret)).toBe(false);
  });

  it('returns false for tampered body', () => {
    const body = '{"entry":[]}';
    const signature = sign(body, appSecret);
    expect(verifyWebhookSignature('{"entry":[{"id":"x"}]}', signature, appSecret)).toBe(false);
  });
});
