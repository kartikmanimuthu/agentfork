import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExpireStale } = vi.hoisted(() => ({ mockExpireStale: vi.fn() }));

vi.mock('@chatbot/shared', () => ({
  getPrismaClient: vi.fn(() => ({ __db: true })),
}));

// TranscriptionUploadService pulls in S3Service, so it lives behind the dedicated subpath
// (see libs/shared/src/server.ts) instead of the main barrel — mock it separately.
vi.mock('@chatbot/shared/server', () => ({
  TranscriptionUploadService: { expireStale: mockExpireStale },
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { handleTranscriptionUploadExpiry } from './handler';

describe('handleTranscriptionUploadExpiry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sweeps stale uploads using the shared prisma client', async () => {
    mockExpireStale.mockResolvedValue(3);
    await handleTranscriptionUploadExpiry();
    expect(mockExpireStale).toHaveBeenCalledWith({ __db: true });
  });

  it('completes quietly when there is nothing to expire', async () => {
    mockExpireStale.mockResolvedValue(0);
    await expect(handleTranscriptionUploadExpiry()).resolves.toBeUndefined();
  });

  it('rethrows so pg-boss retries the sweep on failure', async () => {
    mockExpireStale.mockRejectedValue(new Error('db unavailable'));
    await expect(handleTranscriptionUploadExpiry()).rejects.toThrow('db unavailable');
  });
});
