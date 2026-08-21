import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptionApiKeyService } from './transcription-api-key-service';

function mockDb() {
  return {
    transcriptionApiKey: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'key-1', ...args.data })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({
        id: 'key-1',
        tenantId: 'tenant-1',
        name: 'Production key',
        modelId: null,
        dailyReqLimit: 1000,
        dailyMinutesLimit: 600,
        minuteReqLimit: 100,
        scopes: ['transcription:write'],
        webhookUrl: 'https://you.example.com/hook',
        webhookSecret: 'whsec_existing_secret_value',
        createdBy: 'user-1',
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'key-1', ...args.data })),
      delete: vi.fn(async () => ({ id: 'key-1' })),
    },
    transcriptionApiKeyUsage: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async (args: any) => ({ id: 'usage-1', ...args.create })),
    },
  };
}

describe('TranscriptionApiKeyService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: TranscriptionApiKeyService;

  beforeEach(() => {
    db = mockDb();
    service = new TranscriptionApiKeyService('tenant-1', db as any);
  });

  describe('create', () => {
    it('generates a raw key with the sk_ prefix and stores only its hash + prefix', async () => {
      const { rawKey, apiKey } = await service.create({ name: 'My Key', createdBy: 'user-1' });

      expect(rawKey).toMatch(/^sk_/);
      const createCall = db.transcriptionApiKey.create.mock.calls[0][0].data;
      expect(createCall.keyHash).not.toBe(rawKey);
      expect(createCall.keyHash).toHaveLength(64); // sha256 hex
      expect(createCall.keyPrefix).toBe(rawKey.slice(0, 12));
      expect(apiKey.id).toBe('key-1');
    });

    it('defaults scopes to ["transcription:write"]', async () => {
      await service.create({ name: 'My Key', createdBy: 'user-1' });
      const data = db.transcriptionApiKey.create.mock.calls[0][0].data;
      expect(data.scopes).toEqual(['transcription:write']);
    });

    it('honors explicit limits and webhook fields over defaults', async () => {
      await service.create({
        name: 'My Key',
        createdBy: 'user-1',
        dailyReqLimit: 50,
        dailyMinutesLimit: 30,
        minuteReqLimit: 5,
        webhookUrl: 'https://you.example.com/hook',
        webhookSecret: 'whsec_abc',
      });
      const data = db.transcriptionApiKey.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        dailyReqLimit: 50,
        dailyMinutesLimit: 30,
        minuteReqLimit: 5,
        webhookUrl: 'https://you.example.com/hook',
        webhookSecret: 'whsec_abc',
      });
    });

    it('scopes the created key to the tenant with active status', async () => {
      await service.create({ name: 'My Key', createdBy: 'user-1' });
      const data = db.transcriptionApiKey.create.mock.calls[0][0].data;
      expect(data.tenantId).toBe('tenant-1');
      expect(data.status).toBe('active');
    });
  });

  describe('list', () => {
    it('scopes to the tenant with no filters', async () => {
      await service.list();
      expect(db.transcriptionApiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } })
      );
    });

    it('applies status and jobConfigId filters when provided', async () => {
      await service.list({ status: 'active', jobConfigId: 'jc-1' });
      expect(db.transcriptionApiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1', status: 'active', jobConfigId: 'jc-1' } })
      );
    });
  });

  it('revoke sets status to revoked, scoped to the tenant', async () => {
    await service.revoke('key-1');
    expect(db.transcriptionApiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1', tenantId: 'tenant-1' },
      data: expect.objectContaining({ status: 'revoked' }),
    });
  });

  describe('rotate', () => {
    it('throws when the key does not exist', async () => {
      db.transcriptionApiKey.findFirst.mockResolvedValue(null);
      await expect(service.rotate('missing')).rejects.toThrow('Transcription API key not found');
    });

    it('marks the old key rotating with a grace-period expiry and creates a replacement carrying its settings', async () => {
      const { rawKey, apiKey } = await service.rotate('key-1', 24);

      expect(db.transcriptionApiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1', tenantId: 'tenant-1' },
        data: expect.objectContaining({ status: 'rotating', expiresAt: expect.any(Date) }),
      });

      expect(rawKey).toMatch(/^sk_/);
      const createData = db.transcriptionApiKey.create.mock.calls[0][0].data;
      expect(createData.name).toBe('Production key (rotated)');
      expect(createData.dailyReqLimit).toBe(1000);
      expect(createData.webhookUrl).toBe('https://you.example.com/hook');
      expect(createData.webhookSecret).toBe('whsec_existing_secret_value');
      expect(apiKey.id).toBe('key-1');
    });
  });

  it('delete is scoped to the tenant', async () => {
    await service.delete('key-1');
    expect(db.transcriptionApiKey.delete).toHaveBeenCalledWith({ where: { id: 'key-1', tenantId: 'tenant-1' } });
  });

  describe('rotateWebhookSecret', () => {
    it('generates a whsec_-prefixed secret and persists it', async () => {
      const { rawSecret, hasSecret } = await service.rotateWebhookSecret('key-1');
      expect(rawSecret).toMatch(/^whsec_/);
      expect(hasSecret).toBe(true);
      expect(db.transcriptionApiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1', tenantId: 'tenant-1' },
        data: expect.objectContaining({ webhookSecret: rawSecret }),
      });
    });

    it('throws when the key does not exist', async () => {
      db.transcriptionApiKey.findFirst.mockResolvedValue(null);
      await expect(service.rotateWebhookSecret('missing')).rejects.toThrow('Transcription API key not found');
    });
  });

  describe('getWebhookSecretStatus', () => {
    it('reports hasSecret + a masked hint when a secret is set', async () => {
      const status = await service.getWebhookSecretStatus('key-1');
      expect(status.hasSecret).toBe(true);
      expect(status.hint).toBe('whsec_exis...');
    });

    it('reports no secret when none is configured', async () => {
      db.transcriptionApiKey.findFirst.mockResolvedValue({ webhookSecret: null });
      const status = await service.getWebhookSecretStatus('key-1');
      expect(status).toEqual({ hasSecret: false, hint: null });
    });

    it('throws when the key does not exist', async () => {
      db.transcriptionApiKey.findFirst.mockResolvedValue(null);
      await expect(service.getWebhookSecretStatus('missing')).rejects.toThrow('Transcription API key not found');
    });
  });

  describe('checkQuota (static)', () => {
    const limits = { dailyReqLimit: 100, dailyMinutesLimit: 60, minuteReqLimit: 5 };

    it('allows the request when usage is well under every limit', async () => {
      const result = await TranscriptionApiKeyService.checkQuota(db as any, 'key-1', limits);
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(100);
      expect(result.remainingMinutes).toBe(60);
    });

    it('blocks when the daily request limit is reached', async () => {
      db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({
        requestCount: 100, minutesCount: 10, minuteReqCount: 0, minuteResetAt: new Date(0),
      });
      const result = await TranscriptionApiKeyService.checkQuota(db as any, 'key-1', limits);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Daily request limit/);
      expect(result.remainingRequests).toBe(0);
    });

    it('blocks when the daily minutes limit is reached', async () => {
      db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({
        requestCount: 10, minutesCount: 60, minuteReqCount: 0, minuteResetAt: new Date(0),
      });
      const result = await TranscriptionApiKeyService.checkQuota(db as any, 'key-1', limits);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Daily audio-minutes limit/);
      expect(result.remainingMinutes).toBe(0);
    });

    it('blocks with a retryAfter when the per-minute rate limit is hit within the current window', async () => {
      const now = new Date('2026-01-01T00:00:30.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({
          requestCount: 10,
          minutesCount: 10,
          minuteReqCount: 5,
          minuteResetAt: new Date('2026-01-01T00:00:00.000Z'), // 30s into the 60s window
        });
        const result = await TranscriptionApiKeyService.checkQuota(db as any, 'key-1', limits);
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/Rate limit/);
        expect(result.retryAfter).toBe(30);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not rate-limit once the per-minute window has rolled over', async () => {
      const now = new Date('2026-01-01T00:02:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({
          requestCount: 10,
          minutesCount: 10,
          minuteReqCount: 5,
          minuteResetAt: new Date('2026-01-01T00:00:00.000Z'), // 2 minutes ago — window elapsed
        });
        const result = await TranscriptionApiKeyService.checkQuota(db as any, 'key-1', limits);
        expect(result.allowed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('reserveRequest (static)', () => {
    it('creates a fresh usage row for the first request of the day', async () => {
      await TranscriptionApiKeyService.reserveRequest(db as any, 'key-1');
      expect(db.transcriptionApiKeyUsage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ apiKeyId: 'key-1', requestCount: 1, minuteReqCount: 1 }),
        })
      );
    });

    it('increments minuteReqCount within the current minute window', async () => {
      const now = new Date('2026-01-01T00:00:30.000Z');
      db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({
        requestCount: 3,
        minuteReqCount: 2,
        minuteResetAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        await TranscriptionApiKeyService.reserveRequest(db as any, 'key-1');
        const call = db.transcriptionApiKeyUsage.upsert.mock.calls[0][0];
        expect(call.update.minuteReqCount).toEqual({ increment: 1 });
        expect(call.update.requestCount).toEqual({ increment: 1 });
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets minuteReqCount to 1 once the minute window has elapsed', async () => {
      const now = new Date('2026-01-01T00:02:00.000Z');
      db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({
        requestCount: 3,
        minuteReqCount: 5,
        minuteResetAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        await TranscriptionApiKeyService.reserveRequest(db as any, 'key-1');
        const call = db.transcriptionApiKeyUsage.upsert.mock.calls[0][0];
        expect(call.update.minuteReqCount).toBe(1);
        expect(call.update.minuteResetAt).toEqual(now);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('recordAudioMinutes (static)', () => {
    it('is a no-op for zero or negative minutes', async () => {
      await TranscriptionApiKeyService.recordAudioMinutes(db as any, 'key-1', 0);
      await TranscriptionApiKeyService.recordAudioMinutes(db as any, 'key-1', -5);
      expect(db.transcriptionApiKeyUsage.upsert).not.toHaveBeenCalled();
    });

    it('upserts an increment for positive minutes', async () => {
      await TranscriptionApiKeyService.recordAudioMinutes(db as any, 'key-1', 2.5);
      expect(db.transcriptionApiKeyUsage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { minutesCount: { increment: 2.5 } } })
      );
    });
  });

  describe('getUsage', () => {
    it('returns zeroes when there is no usage row yet', async () => {
      const usage = await service.getUsage('key-1');
      expect(usage).toEqual({ requestCount: 0, minutesCount: 0 });
    });

    it('returns the stored counts when a usage row exists', async () => {
      db.transcriptionApiKeyUsage.findFirst.mockResolvedValue({ requestCount: 7, minutesCount: 12.5 });
      const usage = await service.getUsage('key-1');
      expect(usage).toEqual({ requestCount: 7, minutesCount: 12.5 });
    });
  });
});
