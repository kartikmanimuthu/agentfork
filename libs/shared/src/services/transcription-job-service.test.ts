import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptionJobService } from './transcription-job-service';

function mockDb() {
  return {
    transcriptionJob: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'job-1', ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'job-1', ...args.data })),
      findFirst: vi.fn(async () => null),
    },
  };
}

describe('TranscriptionJobService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: TranscriptionJobService;

  beforeEach(() => {
    db = mockDb();
    service = new TranscriptionJobService(db as any);
  });

  describe('create', () => {
    it('defaults to status "running" and sets startedAt', async () => {
      await service.create({ apiKeyId: 'key-1', tenantId: 'tenant-1', source: 'payload' });

      expect(db.transcriptionJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'running', startedAt: expect.any(Date) }),
      });
    });

    it('honors an explicit "queued" status and leaves startedAt null', async () => {
      await service.create({ apiKeyId: 'key-1', tenantId: 'tenant-1', source: 'upload', status: 'queued' });

      expect(db.transcriptionJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'queued', startedAt: null }),
      });
    });

    it('normalizes optional fields to null instead of undefined', async () => {
      await service.create({ apiKeyId: 'key-1', tenantId: 'tenant-1', source: 'payload' });

      const data = db.transcriptionJob.create.mock.calls[0][0].data;
      expect(data.jobConfigId).toBeNull();
      expect(data.modelId).toBeNull();
      expect(data.s3Key).toBeNull();
      expect(data.webhookUrl).toBeNull();
    });
  });

  it('markRunning sets status to running and stamps startedAt', async () => {
    await service.markRunning('job-1');
    expect(db.transcriptionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'running', startedAt: expect.any(Date) },
    });
  });

  describe('complete', () => {
    it('marks the job completed with the transcript and stamps completedAt', async () => {
      await service.complete('job-1', { transcript: 'hello', latencyMs: 500 });

      expect(db.transcriptionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'completed',
          transcript: 'hello',
          latencyMs: 500,
          completedAt: expect.any(Date),
        }),
      });
    });

    it('omits providerVersionId entirely when not provided (does not overwrite with undefined)', async () => {
      await service.complete('job-1', { transcript: 'hello', latencyMs: 500 });
      const data = db.transcriptionJob.update.mock.calls[0][0].data;
      expect('providerVersionId' in data).toBe(false);
    });

    it('includes providerVersionId when explicitly passed', async () => {
      await service.complete('job-1', { transcript: 'hello', latencyMs: 500, providerVersionId: 'v-1' });
      const data = db.transcriptionJob.update.mock.calls[0][0].data;
      expect(data.providerVersionId).toBe('v-1');
    });
  });

  it('fail marks the job failed with the error message and stamps completedAt', async () => {
    await service.fail('job-1', 'engine unreachable', 1200);
    expect(db.transcriptionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'failed',
        error: 'engine unreachable',
        latencyMs: 1200,
        completedAt: expect.any(Date),
      },
    });
  });

  describe('setWebhookResult', () => {
    it('records a delivered webhook and increments the attempt count', async () => {
      await service.setWebhookResult('job-1', true);
      expect(db.transcriptionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          webhookStatus: 'delivered',
          webhookDeliveredAt: expect.any(Date),
          webhookAttempts: { increment: 1 },
        },
      });
    });

    it('records a failed webhook without a delivered timestamp', async () => {
      await service.setWebhookResult('job-1', false);
      expect(db.transcriptionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          webhookStatus: 'failed',
          webhookDeliveredAt: null,
          webhookAttempts: { increment: 1 },
        },
      });
    });
  });

  it('findById scopes the lookup to the given tenant and includes the upload reference', async () => {
    await service.findById('job-1', 'tenant-1');
    expect(db.transcriptionJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', tenantId: 'tenant-1' },
      include: { upload: { select: { id: true, clientReference: true } } },
    });
  });

  it('create persists uploadId when the job claims an upload', async () => {
    await service.create({ apiKeyId: 'key-1', tenantId: 'tenant-1', source: 'upload', uploadId: 'up-1' });
    expect(db.transcriptionJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ uploadId: 'up-1' }),
    });
  });
});
