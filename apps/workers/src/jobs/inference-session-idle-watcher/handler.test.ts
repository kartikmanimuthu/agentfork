import { describe, it, expect, vi, beforeEach } from 'vitest';
import type PgBoss from 'pg-boss';
import { handleInferenceSessionIdleWatcher } from './handler';

const mockPrisma = {
  inferenceSession: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
};

const mockBoss = {
  send: vi.fn(),
} as unknown as PgBoss;

vi.mock('@chatbot/shared/workers', () => ({
  getPrismaClient: vi.fn(() => mockPrisma),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

beforeEach(() => {
  mockPrisma.inferenceSession.findMany.mockReset();
  mockPrisma.inferenceSession.updateMany.mockReset();
  (mockBoss.send as ReturnType<typeof vi.fn>).mockReset();
});

describe('handleInferenceSessionIdleWatcher', () => {
  it('ends each stale session and enqueues an analytics job per row', async () => {
    mockPrisma.inferenceSession.findMany
      .mockResolvedValueOnce([
        { id: 'sess_1', tenantId: 't_1' },
        { id: 'sess_2', tenantId: 't_1' },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.inferenceSession.updateMany.mockResolvedValue({ count: 1 });

    await handleInferenceSessionIdleWatcher(mockBoss);

    expect(mockPrisma.inferenceSession.updateMany).toHaveBeenCalledTimes(2);
    expect(mockBoss.send).toHaveBeenCalledTimes(2);
    expect(mockBoss.send).toHaveBeenCalledWith('inference-session-analytics', {
      sessionId: 'sess_1',
      tenantId: 't_1',
    });
    expect(mockBoss.send).toHaveBeenCalledWith('inference-session-analytics', {
      sessionId: 'sess_2',
      tenantId: 't_1',
    });
  });

  it('does not enqueue when updateMany finds zero rows (concurrent watcher already ended it)', async () => {
    mockPrisma.inferenceSession.findMany.mockResolvedValueOnce([{ id: 'sess_x', tenantId: 't_1' }]).mockResolvedValueOnce([]);
    mockPrisma.inferenceSession.updateMany.mockResolvedValue({ count: 0 });

    await handleInferenceSessionIdleWatcher(mockBoss);

    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it('exits cleanly when there are no stale sessions', async () => {
    mockPrisma.inferenceSession.findMany.mockResolvedValueOnce([]);

    await handleInferenceSessionIdleWatcher(mockBoss);

    expect(mockPrisma.inferenceSession.updateMany).not.toHaveBeenCalled();
    expect(mockBoss.send).not.toHaveBeenCalled();
  });
});
