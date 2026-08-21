import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

vi.mock('../env', () => ({
  env: { AWS_REGION: 'us-east-1', S3_BUCKET: 'test-bucket', S3_ENDPOINT: undefined, S3_FORCE_PATH_STYLE: undefined },
}));

vi.mock('../logging/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { S3Service } from './s3-service';

function readableFrom(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('S3Service', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('downloadAsBuffer', () => {
    it('returns the concatenated buffer on a normal response', async () => {
      mockSend.mockResolvedValue({ Body: readableFrom([new Uint8Array([1, 2]), new Uint8Array([3, 4])]) });

      const result = await new S3Service().downloadAsBuffer('some/key');

      expect(result).toEqual(Buffer.from([1, 2, 3, 4]));
    });

    it('throws when the response has no Body', async () => {
      mockSend.mockResolvedValue({ Body: undefined });

      await expect(new S3Service().downloadAsBuffer('some/key')).rejects.toThrow('S3 object not found');
    });

    it('rejects with a timeout error instead of hanging forever when the call never resolves', async () => {
      mockSend.mockImplementation(() => new Promise(() => {})); // never resolves — simulates a stalled connection

      await expect(new S3Service().downloadAsBuffer('some/key', 20)).rejects.toThrow(/timed out after \d+ms/);
    });

    it('retries after a transient stall instead of failing on the first attempt', async () => {
      // First attempt never resolves (stalled connection); second attempt succeeds immediately —
      // mirrors what's actually been observed against S3: a stalled GetObject followed by a
      // near-instant success on retry, same key, same bucket. A short per-attempt timeout (with
      // a longer overall budget) keeps this deterministic and fast without waiting on real timers.
      mockSend
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce({ Body: readableFrom([new Uint8Array([1, 2])]) });

      const result = await new S3Service().downloadAsBuffer('some/key', 500, 20);

      expect(result).toEqual(Buffer.from([1, 2]));
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('passes an abortSignal to the SDK call so the timeout can actually cancel the request', async () => {
      mockSend.mockResolvedValue({ Body: readableFrom([new Uint8Array([1])]) });

      await new S3Service().downloadAsBuffer('some/key');

      const [, options] = mockSend.mock.calls[0]!;
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('uploadBuffer', () => {
    it('resolves normally on a successful upload', async () => {
      mockSend.mockResolvedValue({});

      await expect(new S3Service().uploadBuffer('some/key', Buffer.from('data'), 'application/json')).resolves.toBeUndefined();
    });

    it('rejects with a timeout error instead of hanging forever when the call never resolves', async () => {
      mockSend.mockImplementation(() => new Promise(() => {}));

      await expect(
        new S3Service().uploadBuffer('some/key', Buffer.from('data'), 'application/json', 20)
      ).rejects.toThrow(/timed out after 20ms/);
    });
  });
});
