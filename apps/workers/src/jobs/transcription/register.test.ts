import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHealOrphaned } = vi.hoisted(() => ({ mockHealOrphaned: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./handler.js', () => ({ handleTranscription: vi.fn() }));
vi.mock('./self-heal.js', () => ({ healOrphanedTranscriptionJobs: mockHealOrphaned }));
vi.mock('@chatbot/shared', () => ({ getPrismaClient: vi.fn(() => ({})), env: { TRANSCRIPTION_WORKER_BATCH_SIZE: 2 } }));
vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { register } from './register';
import { env } from '@chatbot/shared';

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

function getWorkCallbacks(boss: ReturnType<typeof createMockBoss>) {
  return boss.work.mock.calls.map((call) => call[2] as (jobs: unknown[]) => Promise<void>);
}

async function getWorkCallback(boss: ReturnType<typeof createMockBoss>) {
  return getWorkCallbacks(boss)[0];
}

const baseJob = { id: 'job-1', data: {}, retryCount: 0, retryLimit: 5 };

describe('transcription register', () => {
  beforeEach(() => {
    mockHealOrphaned.mockReset().mockResolvedValue(undefined);
  });

  it('calls both createQueue and updateQueue so a pre-existing queue picks up changed retry settings', async () => {
    const boss = createMockBoss();
    await register(boss as never, createMockExecutor(async () => undefined));

    expect(boss.createQueue).toHaveBeenCalledWith('transcription', expect.objectContaining({ retryLimit: 5, retryDelay: 2, retryBackoff: false }));
    expect(boss.updateQueue).toHaveBeenCalledWith('transcription', expect.objectContaining({ retryLimit: 5, retryDelay: 2, retryBackoff: false }));
  });

  it('heals orphaned jobs before starting the work() loop, and never lets a healing failure stop registration', async () => {
    const boss = createMockBoss();
    mockHealOrphaned.mockRejectedValue(new Error('heal failed'));

    await expect(register(boss as never, createMockExecutor(async () => undefined))).resolves.toBeUndefined();

    expect(mockHealOrphaned).toHaveBeenCalledWith(boss, expect.anything());
    expect(boss.work).toHaveBeenCalled();
    const healOrderIndex = mockHealOrphaned.mock.invocationCallOrder[0];
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

      expect(executor.execute).toHaveBeenCalledTimes(1);
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-1');
      expect(boss.fail).not.toHaveBeenCalled();
    });

    it("a slow job in one registration's slot does not block a fast job in another slot from completing", async () => {
      const boss = createMockBoss();
      const order: string[] = [];
      const executor = createMockExecutor(async (_jobName, jobData) => {
        const id = (jobData as { jobId?: string }).jobId ?? 'unknown';
        order.push(`start-${id}`);
        // job-slow resolves after job-fast's callback has already completed, which only
        // happens if the two registrations poll and process independently — a shared batch
        // would keep job-fast's slot occupied until job-slow also finished.
        if (id === 'job-slow') await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end-${id}`);
      });
      await register(boss as never, executor);
      const [callbackA, callbackB] = getWorkCallbacks(boss);

      const slowPromise = callbackA([{ ...baseJob, id: 'job-slow', data: { jobId: 'job-slow' } }]);
      await callbackB([{ ...baseJob, id: 'job-fast', data: { jobId: 'job-fast' } }]);

      // job-fast's callback has already resolved while job-slow's is still in flight — proof
      // that the two registrations' slots are independent, not coupled to a shared batch.
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-fast');
      expect(order).toContain('end-job-fast');
      expect(order).not.toContain('end-job-slow');

      await slowPromise;
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-slow');
    });

    it("one registration's failing job does not prevent another registration's job from completing", async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async (_jobName, jobData) => {
        const id = (jobData as { jobId?: string }).jobId ?? 'unknown';
        if (id === 'job-bad') throw new Error('boom');
      });
      await register(boss as never, executor);
      const [callbackA, callbackB] = getWorkCallbacks(boss);

      await Promise.all([
        callbackA([{ ...baseJob, id: 'job-bad', data: { jobId: 'job-bad' } }]),
        callbackB([{ ...baseJob, id: 'job-good', data: { jobId: 'job-good' } }]),
      ]);

      expect(boss.fail).toHaveBeenCalledWith('transcription', 'job-bad', { name: 'Error', message: 'boom' });
      expect(boss.complete).toHaveBeenCalledWith('transcription', 'job-good');
      expect(boss.complete).not.toHaveBeenCalledWith('transcription', 'job-bad');
    });

    it('registers boss.work() once per configured batch size, each with batchSize: 1', async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async () => undefined);
      await register(boss as never, executor);

      expect(boss.work).toHaveBeenCalledTimes(env.TRANSCRIPTION_WORKER_BATCH_SIZE);
      for (const call of boss.work.mock.calls) {
        expect(call[0]).toBe('transcription');
        expect(call[1]).toEqual({ batchSize: 1, includeMetadata: true });
      }
    });

    it('does not call fail() when complete() itself throws after a successful execution, so it cannot trigger a duplicate-webhook retry', async () => {
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

      expect(boss.fail).toHaveBeenCalledWith('transcription', 'job-1', { name: 'Error', message: 'boom' });
      expect(boss.complete).not.toHaveBeenCalled();
    });

    it('does not rethrow when fail() itself also throws, so one bad job cannot fail the whole batch callback', async () => {
      const boss = createMockBoss();
      boss.fail.mockRejectedValue(new Error('fail() db error'));
      const executor = createMockExecutor(async () => {
        throw new Error('boom');
      });
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await expect(callback([baseJob])).resolves.toBeUndefined();

      expect(boss.fail).toHaveBeenCalledWith('transcription', 'job-1', { name: 'Error', message: 'boom' });
      expect(boss.complete).not.toHaveBeenCalled();
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

    it('marks isFinalAttempt false when retries remain', async () => {
      const boss = createMockBoss();
      const executor = createMockExecutor(async () => undefined);
      await register(boss as never, executor);
      const callback = await getWorkCallback(boss);

      await callback([{ ...baseJob, retryCount: 2, retryLimit: 5 }]);

      const [, jobData] = executor.execute.mock.calls[0];
      expect((jobData as { isFinalAttempt: boolean }).isFinalAttempt).toBe(false);
    });
  });
});
