import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryRaw, mockSetWebhookResult, mockBossFail } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockSetWebhookResult: vi.fn().mockResolvedValue(undefined),
  mockBossFail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@chatbot/shared', () => ({
  TranscriptionJobService: vi.fn().mockImplementation(() => ({
    setWebhookResult: mockSetWebhookResult,
  })),
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { healStuckWebhookRetryJobs } from './self-heal';

const db = { $queryRaw: mockQueryRaw } as any;
const boss = { fail: mockBossFail } as any;

const stuckRow = {
  id: 'pgboss-retry-job-1',
  data: { jobId: 'job-1', tenantId: 'tenant-1' },
  retry_count: 9,
  retry_limit: 5,
};

describe('healStuckWebhookRetryJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetWebhookResult.mockResolvedValue(undefined);
    mockBossFail.mockResolvedValue(undefined);
  });

  it('does nothing when no jobs have exceeded their retry limit', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await healStuckWebhookRetryJobs(boss, db);

    expect(mockBossFail).not.toHaveBeenCalled();
    expect(mockSetWebhookResult).not.toHaveBeenCalled();
  });

  it('marks the underlying job undeliverable and force-fails the pg-boss row', async () => {
    mockQueryRaw.mockResolvedValue([stuckRow]);

    await healStuckWebhookRetryJobs(boss, db);

    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-1', false, true);
    expect(mockBossFail).toHaveBeenCalledWith('transcription-webhook-retry', 'pgboss-retry-job-1', expect.objectContaining({ name: 'Error' }));
  });

  it('processes every stuck job found, even if one of them fails to heal', async () => {
    const secondRow = { ...stuckRow, id: 'pgboss-retry-job-2', data: { jobId: 'job-2', tenantId: 'tenant-1' } };
    mockQueryRaw.mockResolvedValue([stuckRow, secondRow]);
    mockBossFail.mockRejectedValueOnce(new Error('db blip')).mockResolvedValueOnce(undefined);

    await healStuckWebhookRetryJobs(boss, db);

    expect(mockBossFail).toHaveBeenCalledTimes(2);
    // job-1's boss.fail() rejected, so its own path errored, but job-2 must still be healed
    // rather than the whole batch aborting.
    expect(mockSetWebhookResult).toHaveBeenCalledWith('job-2', false, true);
  });
});
