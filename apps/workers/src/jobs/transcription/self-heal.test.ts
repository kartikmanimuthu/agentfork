import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryRaw, mockJobFail, mockSetWebhookResult, mockDeliverWithToken, mockBossFail } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockJobFail: vi.fn().mockResolvedValue(undefined),
  mockSetWebhookResult: vi.fn().mockResolvedValue(undefined),
  mockDeliverWithToken: vi.fn(),
  mockBossFail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@chatbot/shared', () => ({
  TranscriptionJobService: vi.fn().mockImplementation(() => ({
    fail: mockJobFail,
    setWebhookResult: mockSetWebhookResult,
  })),
  WebhookService: vi.fn().mockImplementation(() => ({
    deliverWithToken: mockDeliverWithToken,
  })),
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { healOrphanedTranscriptionJobs } from './self-heal';

const db = { $queryRaw: mockQueryRaw } as any;
const boss = { fail: mockBossFail } as any;

const staleRow = {
  id: 'pgboss-job-1',
  data: {
    jobId: 'job-1',
    tenantId: 'tenant-1',
    webhookUrl: 'https://you.example.com/hook',
    webhookSecret: 'whsec_abc',
    fileName: 'call.wav',
    mimeType: 'audio/wav',
    s3Key: 'transcription/_uploads/tenant-1/call.wav',
    uploadId: 'up-1',
    clientReference: 'ref-1',
  },
};

describe('healOrphanedTranscriptionJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobFail.mockResolvedValue(undefined);
    mockSetWebhookResult.mockResolvedValue(undefined);
    mockBossFail.mockResolvedValue(undefined);
  });

  it('does nothing when there are no stale active jobs', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await healOrphanedTranscriptionJobs(boss, db);

    expect(mockBossFail).not.toHaveBeenCalled();
    expect(mockJobFail).not.toHaveBeenCalled();
  });

  it('fails the pg-boss job and the TranscriptionJob row, and delivers the failure webhook', async () => {
    mockQueryRaw.mockResolvedValue([staleRow]);
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });

    await healOrphanedTranscriptionJobs(boss, db);

    expect(mockBossFail).toHaveBeenCalledWith('transcription', 'pgboss-job-1', expect.objectContaining({ name: 'Error' }));
    expect(mockJobFail).toHaveBeenCalledWith('job-1', expect.stringContaining('restarted'));
    expect(mockDeliverWithToken).toHaveBeenCalledWith(
      'https://you.example.com/hook',
      'whsec_abc',
      expect.objectContaining({
        executionId: 'job-1',
        uploadId: 'up-1',
        clientReference: 'ref-1',
        status: 'failed',
        input: { fileName: 'call.wav', mimeType: 'audio/wav', s3Key: 'transcription/_uploads/tenant-1/call.wav' },
      })
    );
    // terminal=true — this is the job's one and only webhook attempt from the healer, no
    // further retries should be scheduled regardless of whether delivery succeeded.
    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', true, true);
  });

  it('marks the webhook result undeliverable (still terminal) when delivery itself fails', async () => {
    mockQueryRaw.mockResolvedValue([staleRow]);
    mockDeliverWithToken.mockResolvedValue({ success: false, error: 'timeout' });

    await healOrphanedTranscriptionJobs(boss, db);

    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', false, true);
  });

  it('does not attempt a webhook when the job has no webhookUrl', async () => {
    mockQueryRaw.mockResolvedValue([{ ...staleRow, data: { ...staleRow.data, webhookUrl: null } }]);

    await healOrphanedTranscriptionJobs(boss, db);

    expect(mockDeliverWithToken).not.toHaveBeenCalled();
    expect(mockJobFail).toHaveBeenCalledWith('job-1', expect.any(String));
  });

  it('processes every stale job found, even if one of them fails to heal', async () => {
    const secondRow = { id: 'pgboss-job-2', data: { ...staleRow.data, jobId: 'job-2', webhookUrl: null } };
    mockQueryRaw.mockResolvedValue([staleRow, secondRow]);
    mockDeliverWithToken.mockResolvedValue({ success: true, status: 200 });
    mockBossFail.mockRejectedValueOnce(new Error('db blip')).mockResolvedValueOnce(undefined);

    await healOrphanedTranscriptionJobs(boss, db);

    expect(mockBossFail).toHaveBeenCalledTimes(2);
    // job-1's boss.fail() rejected, so its jobService.fail()/webhook never ran — but job-2
    // must still be processed rather than the whole batch aborting.
    expect(mockJobFail).toHaveBeenCalledWith('job-2', expect.any(String));
  });
});
