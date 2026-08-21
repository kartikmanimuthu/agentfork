import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDownloadAsBuffer,
  mockMarkRunning,
  mockFail,
  mockResolveTenantFolder,
  mockExecuteTranscription,
  mockTranscribeAudio,
  mockBossSend,
  mockBossStart,
  mockBossStop,
} = vi.hoisted(() => ({
  mockDownloadAsBuffer: vi.fn(),
  mockMarkRunning: vi.fn().mockResolvedValue(undefined),
  mockFail: vi.fn().mockResolvedValue(undefined),
  mockResolveTenantFolder: vi.fn().mockResolvedValue('tenant-folder'),
  mockExecuteTranscription: vi.fn().mockResolvedValue({}),
  mockTranscribeAudio: vi.fn(),
  mockBossSend: vi.fn().mockResolvedValue('boss-job-id'),
  mockBossStart: vi.fn().mockResolvedValue(undefined),
  mockBossStop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@chatbot/shared', () => ({
  getPrismaClient: vi.fn(() => ({})),
  TranscriptionJobService: vi.fn().mockImplementation(() => ({
    markRunning: mockMarkRunning,
    fail: mockFail,
  })),
  resolveTenantFolder: mockResolveTenantFolder,
  // Pass-through — withTimeout's own timeout mechanics are covered by its dedicated unit
  // tests; here we only need it to forward whatever resolveTenantFolder does (resolve or
  // reject), same as the real implementation.
  withTimeout: (promise: Promise<unknown>) => promise,
  env: { TRANSCRIPTION_ENGINE_ASYNC_TIMEOUT_MS: 600_000 },
}));

// S3Service and executeTranscription both pull in S3Service (directly, or via s3-service.ts),
// which is why they live behind the dedicated subpath (see libs/shared/src/server.ts) instead
// of the main barrel — mock them together here.
vi.mock('@chatbot/shared/server', () => ({
  S3Service: vi.fn().mockImplementation(() => ({
    downloadAsBuffer: mockDownloadAsBuffer,
  })),
  executeTranscription: mockExecuteTranscription,
}));

vi.mock('@chatbot/ai', () => ({
  transcribeAudio: mockTranscribeAudio,
}));

vi.mock('../../boss.js', () => ({
  createBoss: vi.fn(() => ({
    start: mockBossStart,
    send: mockBossSend,
    stop: mockBossStop,
  })),
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { handleTranscription } from './handler';

const basePayload = {
  jobId: 'job-1',
  tenantId: 'tenant-1',
  apiKeyId: 'key-1',
  source: 'upload' as const,
  stashKey: 'transcription/tenant-folder/job-1/input/call.wav',
  mimeType: 'audio/wav',
};

describe('handleTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkRunning.mockResolvedValue(undefined);
    mockFail.mockResolvedValue(undefined);
    mockResolveTenantFolder.mockResolvedValue('tenant-folder');
    mockExecuteTranscription.mockResolvedValue({});
    mockBossStart.mockResolvedValue(undefined);
    mockBossStop.mockResolvedValue(undefined);
    mockBossSend.mockResolvedValue('boss-job-id');
  });

  it('validates the payload with the Zod schema', async () => {
    await expect(handleTranscription({ jobId: 'job-1' })).rejects.toThrow();
    expect(mockMarkRunning).not.toHaveBeenCalled();
  });

  it('marks the job running before doing anything else', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
    await handleTranscription(basePayload);
    expect(mockMarkRunning).toHaveBeenCalledWith('job-1');
  });

  it('downloads the audio from the stash key and runs executeTranscription', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio-bytes'));
    await handleTranscription({ ...basePayload, language: 'hi', diarize: true, webhookUrl: 'https://hook.example.com', webhookSecret: 'whsec_abc' });

    expect(mockDownloadAsBuffer).toHaveBeenCalledWith(basePayload.stashKey);
    expect(mockResolveTenantFolder).toHaveBeenCalledWith('tenant-1', {});
    expect(mockExecuteTranscription).toHaveBeenCalledTimes(1);

    const [, transcribeFn, params] = mockExecuteTranscription.mock.calls[0];
    expect(transcribeFn).toBe(mockTranscribeAudio);
    expect(params).toMatchObject({
      jobId: 'job-1',
      tenantId: 'tenant-1',
      tenantFolder: 'tenant-folder',
      apiKeyId: 'key-1',
      audio: Buffer.from('audio-bytes'),
      mimeType: 'audio/wav',
      language: 'hi',
      diarize: true,
      engineTimeoutMs: 600_000,
      webhookUrl: 'https://hook.example.com',
      webhookSecret: 'whsec_abc',
    });
  });

  it('passes isFinalAttempt through to executeTranscription', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio-bytes'));
    await handleTranscription({ ...basePayload, isFinalAttempt: false });

    const params = mockExecuteTranscription.mock.calls[0][2];
    expect(params.isFinalAttempt).toBe(false);
  });

  it('passes totalAttempts through to executeTranscription', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio-bytes'));
    await handleTranscription({ ...basePayload, isFinalAttempt: true, totalAttempts: 6 });

    const params = mockExecuteTranscription.mock.calls[0][2];
    expect(params.totalAttempts).toBe(6);
  });

  it('converts null optional fields to undefined for executeTranscription', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
    await handleTranscription({
      ...basePayload,
      jobConfigId: null,
      modelId: null,
      versionId: null,
      fileName: null,
      s3Key: null,
      uploadId: null,
      clientReference: null,
      language: null,
      diarize: null,
      webhookUrl: null,
      webhookSecret: null,
    });

    const params = mockExecuteTranscription.mock.calls[0][2];
    expect(params.jobConfigId).toBeUndefined();
    expect(params.modelId).toBeUndefined();
    expect(params.versionId).toBeUndefined();
    expect(params.s3Key).toBeUndefined();
    expect(params.uploadId).toBeUndefined();
    expect(params.clientReference).toBeUndefined();
    expect(params.webhookUrl).toBeUndefined();
    expect(params.webhookSecret).toBeUndefined();
  });

  it('forwards uploadId and clientReference so the webhook can echo the caller’s identifiers', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
    await handleTranscription({ ...basePayload, uploadId: 'up-1', clientReference: 'recording_8891' });

    const params = mockExecuteTranscription.mock.calls[0][2];
    expect(params.uploadId).toBe('up-1');
    expect(params.clientReference).toBe('recording_8891');
  });

  it('wires onWebhookFailure to enqueue a transcription-webhook-retry job', async () => {
    mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
    await handleTranscription(basePayload);

    const params = mockExecuteTranscription.mock.calls[0][2];
    await params.onWebhookFailure('job-1');

    expect(mockBossSend).toHaveBeenCalledWith('transcription-webhook-retry', { jobId: 'job-1', tenantId: 'tenant-1' });
    expect(mockBossStop).toHaveBeenCalledWith({ graceful: false });
  });

  describe('when audio cannot be fetched', () => {
    it('throws, marks the job failed with the error message, and never calls executeTranscription', async () => {
      mockDownloadAsBuffer.mockRejectedValue(new Error('S3 object not found'));

      await expect(handleTranscription(basePayload)).rejects.toThrow('S3 object not found');

      expect(mockFail).toHaveBeenCalledWith('job-1', 'S3 object not found');
      expect(mockExecuteTranscription).not.toHaveBeenCalled();
    });

    it('throws a dedicated error when stashKey is missing on an async job', async () => {
      const { stashKey, ...withoutStashKey } = basePayload;

      await expect(handleTranscription(withoutStashKey)).rejects.toThrow('async job missing stashKey');

      expect(mockFail).toHaveBeenCalledWith('job-1', 'async job missing stashKey');
    });

    it('enqueues a webhook retry when a webhookUrl is configured', async () => {
      mockDownloadAsBuffer.mockRejectedValue(new Error('boom'));

      await expect(handleTranscription({ ...basePayload, webhookUrl: 'https://hook.example.com' })).rejects.toThrow('boom');

      expect(mockBossSend).toHaveBeenCalledWith('transcription-webhook-retry', { jobId: 'job-1', tenantId: 'tenant-1' });
    });

    it('does not enqueue a webhook retry when no webhookUrl is configured', async () => {
      mockDownloadAsBuffer.mockRejectedValue(new Error('boom'));

      await expect(handleTranscription(basePayload)).rejects.toThrow('boom');

      expect(mockBossSend).not.toHaveBeenCalled();
    });

    it('does not mark the job failed or notify when isFinalAttempt is false (still rethrows for retry)', async () => {
      mockDownloadAsBuffer.mockRejectedValue(new Error('transient S3 blip'));

      await expect(
        handleTranscription({ ...basePayload, webhookUrl: 'https://hook.example.com', isFinalAttempt: false })
      ).rejects.toThrow('transient S3 blip');

      expect(mockFail).not.toHaveBeenCalled();
      expect(mockBossSend).not.toHaveBeenCalled();
    });

    it('marks the job failed and notifies when isFinalAttempt is true', async () => {
      mockDownloadAsBuffer.mockRejectedValue(new Error('boom'));

      await expect(
        handleTranscription({ ...basePayload, webhookUrl: 'https://hook.example.com', isFinalAttempt: true })
      ).rejects.toThrow('boom');

      expect(mockFail).toHaveBeenCalledWith('job-1', 'boom');
      expect(mockBossSend).toHaveBeenCalledWith('transcription-webhook-retry', { jobId: 'job-1', tenantId: 'tenant-1' });
    });
  });

  describe('when marking the job running fails or times out', () => {
    it('throws, marks the job failed with the error message, and never calls executeTranscription', async () => {
      mockMarkRunning.mockRejectedValue(new Error('Marking job running timed out for job job-1'));

      await expect(handleTranscription(basePayload)).rejects.toThrow('Marking job running timed out');

      expect(mockFail).toHaveBeenCalledWith('job-1', 'Marking job running timed out for job job-1');
      expect(mockDownloadAsBuffer).not.toHaveBeenCalled();
      expect(mockExecuteTranscription).not.toHaveBeenCalled();
    });

    it('does not mark the job failed or notify when isFinalAttempt is false (still rethrows for retry)', async () => {
      mockMarkRunning.mockRejectedValue(new Error('db blip'));

      await expect(
        handleTranscription({ ...basePayload, webhookUrl: 'https://hook.example.com', isFinalAttempt: false })
      ).rejects.toThrow('db blip');

      expect(mockFail).not.toHaveBeenCalled();
      expect(mockBossSend).not.toHaveBeenCalled();
    });
  });

  describe('when tenant folder resolution fails or times out', () => {
    it('throws, marks the job failed with the error message, and never calls executeTranscription', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
      mockResolveTenantFolder.mockRejectedValue(new Error('Resolving tenant folder timed out for tenant tenant-1'));

      await expect(handleTranscription(basePayload)).rejects.toThrow('Resolving tenant folder timed out');

      expect(mockFail).toHaveBeenCalledWith('job-1', 'Resolving tenant folder timed out for tenant tenant-1');
      expect(mockExecuteTranscription).not.toHaveBeenCalled();
    });

    it('does not mark the job failed or notify when isFinalAttempt is false (still rethrows for retry)', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
      mockResolveTenantFolder.mockRejectedValue(new Error('db blip'));

      await expect(
        handleTranscription({ ...basePayload, webhookUrl: 'https://hook.example.com', isFinalAttempt: false })
      ).rejects.toThrow('db blip');

      expect(mockFail).not.toHaveBeenCalled();
      expect(mockBossSend).not.toHaveBeenCalled();
    });

    it('marks the job failed and notifies when isFinalAttempt is true', async () => {
      mockDownloadAsBuffer.mockResolvedValue(Buffer.from('audio'));
      mockResolveTenantFolder.mockRejectedValue(new Error('db blip'));

      await expect(
        handleTranscription({ ...basePayload, webhookUrl: 'https://hook.example.com', isFinalAttempt: true })
      ).rejects.toThrow('db blip');

      expect(mockFail).toHaveBeenCalledWith('job-1', 'db blip');
      expect(mockBossSend).toHaveBeenCalledWith('transcription-webhook-retry', { jobId: 'job-1', tenantId: 'tenant-1' });
    });
  });
});
