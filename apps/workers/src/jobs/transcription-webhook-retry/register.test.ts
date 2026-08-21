import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHealStuckWebhookRetryJobs } = vi.hoisted(() => ({ mockHealStuckWebhookRetryJobs: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./handler.js', () => ({ handleTranscriptionWebhookRetry: vi.fn() }));
vi.mock('./self-heal.js', () => ({ healStuckWebhookRetryJobs: mockHealStuckWebhookRetryJobs }));
vi.mock('@chatbot/shared', () => ({ getPrismaClient: vi.fn(() => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { register } from './register';

function createMockBoss() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    updateQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockExecutor(executeImpl: (jobName: string, jobData: unknown) => Promise<unknown>) {
  return { execute: vi.fn(executeImpl) };
}

async function getWorkCallback(boss: ReturnType<typeof createMockBoss>) {
  const call = boss.work.mock.calls[0];
  return call[2] as (jobs: unknown[]) => Promise<void>;
}

const baseJob = { id: 'job-1', data: {}, retryCount: 0, retryLimit: 5 };

describe('transcription-webhook-retry register', () => {
  beforeEach(() => {
    mockHealStuckWebhookRetryJobs.mockReset().mockResolvedValue(undefined);
  });

  it('calls both createQueue and updateQueue so a pre-existing queue picks up changed retry settings', async () => {
    const boss = createMockBoss();
    await register(boss as never, createMockExecutor(async () => undefined));

    expect(boss.createQueue).toHaveBeenCalledWith('transcription-webhook-retry', expect.objectContaining({ retryLimit: 5, retryDelay: 30, retryBackoff: true }));
    expect(boss.updateQueue).toHaveBeenCalledWith('transcription-webhook-retry', expect.objectContaining({ retryLimit: 5, retryDelay: 30, retryBackoff: true }));
  });

  it('heals stuck webhook-retry jobs before starting the work() loop, and never lets a healing failure stop registration', async () => {
    const boss = createMockBoss();
    mockHealStuckWebhookRetryJobs.mockRejectedValue(new Error('heal failed'));

    await expect(register(boss as never, createMockExecutor(async () => undefined))).resolves.toBeUndefined();

    expect(mockHealStuckWebhookRetryJobs).toHaveBeenCalledWith(boss, expect.anything());
    expect(boss.work).toHaveBeenCalled();
    const healOrderIndex = mockHealStuckWebhookRetryJobs.mock.invocationCallOrder[0];
    const workOrderIndex = boss.work.mock.invocationCallOrder[0];
    expect(healOrderIndex).toBeLessThan(workOrderIndex);
  });

  describe('work callback', () => {
    it('completes the job on success', async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async () => undefined);
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await callback([baseJob]);

      expect(boss.complete).toHaveBeenCalledWith('transcription-webhook-retry', 'job-1');
      expect(boss.fail).not.toHaveBeenCalled();
    });

    it('does not call fail() when complete() itself throws after a successful execution, so it cannot trigger a duplicate retry cycle', async () => {
      const boss = createMockBoss();
      boss.complete.mockRejectedValue(new Error('db blip'));
      const executor = createMockExecutor(async () => undefined);
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await expect(callback([baseJob])).resolves.toBeUndefined();

      expect(boss.fail).not.toHaveBeenCalled();
    });

    it('calls fail() with the error details when execution throws, and does not also call complete()', async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async () => {
        throw new Error('boom');
      });
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await callback([baseJob]);

      expect(boss.fail).toHaveBeenCalledWith('transcription-webhook-retry', 'job-1', { name: 'Error', message: 'boom' });
      expect(boss.complete).not.toHaveBeenCalled();
    });

    it('rethrows the original execution error when fail() itself also throws, instead of swallowing it', async () => {
      const boss = createMockBoss();
      boss.fail.mockRejectedValue(new Error('fail() db error'));
      const executor = createMockExecutor(async () => {
        throw new Error('boom');
      });
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await expect(callback([baseJob])).rejects.toThrow('boom');
    });

    it('computes isFinalAttempt from retryCount >= retryLimit and passes it to the executor', async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async () => undefined);
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await callback([{ ...baseJob, retryCount: 5, retryLimit: 5 }]);

      const [, jobData] = executor.execute.mock.calls[0];
      expect((jobData as { isFinalAttempt: boolean }).isFinalAttempt).toBe(true);
    });
  });
});
