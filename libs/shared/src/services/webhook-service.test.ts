import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Avoid real DNS lookups for the "public hostname" case — deterministic + no network dependency.
vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    },
  },
}));

import { WebhookService, type WebhookPayload } from './webhook-service';

const PUBLIC_URL = 'https://example.com/hooks/transcription';

const basePayload: WebhookPayload = {
  executionId: 'job-1',
  agentId: '',
  status: 'completed',
  input: { fileName: 'call.wav', mimeType: 'audio/wav' },
  output: { text: 'hello world' },
  cacheHit: false,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('WebhookService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('deliver (HMAC, Agent Inference)', () => {
    it('sends X-Webhook-Signature and X-Webhook-Signature-V2 when a secret is set', async () => {
      const service = new WebhookService();
      const result = await service.deliver(PUBLIC_URL, 'shh-secret', basePayload);

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(PUBLIC_URL);
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(headers['X-Webhook-Signature-V2']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(headers['X-Webhook-Timestamp']).toBeDefined();
      expect(headers['Authorization']).toBeUndefined();

      // v1 signature must be a valid HMAC over the raw body alone
      const expectedV1 = crypto.createHmac('sha256', 'shh-secret').update(init.body as string).digest('hex');
      expect(headers['X-Webhook-Signature']).toBe(`sha256=${expectedV1}`);
    });

    it('omits signature headers when no secret is configured', async () => {
      const service = new WebhookService();
      await service.deliver(PUBLIC_URL, null, basePayload);

      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Webhook-Signature']).toBeUndefined();
      expect(headers['X-Webhook-Signature-V2']).toBeUndefined();
    });
  });

  describe('deliverWithToken (static bearer, Transcription)', () => {
    it('sends Authorization: Bearer <token> and no HMAC headers when a token is set', async () => {
      const service = new WebhookService();
      const result = await service.deliverWithToken(PUBLIC_URL, 'whsec_abc123', basePayload);

      expect(result.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(PUBLIC_URL);
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer whsec_abc123');
      expect(headers['X-Webhook-Signature']).toBeUndefined();
      expect(headers['X-Webhook-Signature-V2']).toBeUndefined();
      expect(headers['X-Webhook-Timestamp']).toBeUndefined();
      expect(init.body).toBe(JSON.stringify(basePayload));
    });

    it('omits the Authorization header entirely when no token is configured', async () => {
      const service = new WebhookService();
      await service.deliverWithToken(PUBLIC_URL, null, basePayload);

      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('reports failure when the endpoint responds non-2xx', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const service = new WebhookService();
      const result = await service.deliverWithToken(PUBLIC_URL, 'whsec_abc123', basePayload);
      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
    });

    it('reports failure without throwing when fetch itself rejects', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const service = new WebhookService();
      const result = await service.deliverWithToken(PUBLIC_URL, 'whsec_abc123', basePayload);
      expect(result.success).toBe(false);
      expect(result.error).toBe('network down');
    });
  });

  describe('SSRF guard (shared by both delivery methods)', () => {
    it.each([
      'http://localhost/hooks',
      'http://127.0.0.1/hooks',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://10.0.0.5/hooks',
      'http://192.168.1.1/hooks',
      'http://metadata.google.internal/hooks',
      'ftp://example.com/hooks',
    ])('blocks delivery to %s without ever calling fetch', async (url) => {
      const service = new WebhookService();
      const result = await service.deliverWithToken(url, 'whsec_abc123', basePayload);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows a public https URL through', async () => {
      const service = new WebhookService();
      const result = await service.deliverWithToken(PUBLIC_URL, 'whsec_abc123', basePayload);
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifySignature (legacy v1 reference verifier)', () => {
    it('accepts a correctly computed signature', () => {
      const service = new WebhookService();
      const body = JSON.stringify(basePayload);
      const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
      expect(service.verifySignature(body, sig, 'secret')).toBe(true);
    });

    it('rejects a tampered body', () => {
      const service = new WebhookService();
      const body = JSON.stringify(basePayload);
      const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
      expect(service.verifySignature(body + 'x', sig, 'secret')).toBe(false);
    });

    it('rejects the wrong secret', () => {
      const service = new WebhookService();
      const body = JSON.stringify(basePayload);
      const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
      expect(service.verifySignature(body, sig, 'wrong-secret')).toBe(false);
    });
  });

  describe('verifySignatureV2 (timestamped reference verifier)', () => {
    it('accepts a fresh, correctly computed signature', () => {
      const service = new WebhookService();
      const body = JSON.stringify(basePayload);
      const t = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', 'secret').update(`${t}.${body}`).digest('hex');
      expect(service.verifySignatureV2(body, `t=${t},v1=${v1}`, 'secret')).toBe(true);
    });

    it('rejects a stale timestamp beyond the tolerance window', () => {
      const service = new WebhookService();
      const body = JSON.stringify(basePayload);
      const t = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
      const v1 = crypto.createHmac('sha256', 'secret').update(`${t}.${body}`).digest('hex');
      expect(service.verifySignatureV2(body, `t=${t},v1=${v1}`, 'secret', 300)).toBe(false);
    });

    it('returns false (not throw) on a malformed header', () => {
      const service = new WebhookService();
      expect(service.verifySignatureV2('body', 'not-a-valid-header', 'secret')).toBe(false);
    });
  });
});
