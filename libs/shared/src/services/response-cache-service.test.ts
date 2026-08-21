import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ResponseCacheService, type CacheDb, type CachedResponse } from './response-cache-service';
import { DEFAULT_CACHE_TTL_SECONDS } from './caching-config';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const response: CachedResponse = {
  text: 'hello world',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

function makeDb() {
  return {
    llmResponseCache: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } satisfies CacheDb;
}

describe('ResponseCacheService', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ResponseCacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db = makeDb();
    service = new ResponseCacheService(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateCacheKey', () => {
    const input = {
      agentVersionId: 'ver-1',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      model: 'anthropic.claude-sonnet-4-20250514',
      temperature: 0.7,
    };

    it('is stable for identical input', () => {
      expect(service.generateCacheKey(input)).toBe(service.generateCacheKey({ ...input }));
    });

    it('changes when any keyed field changes', () => {
      const base = service.generateCacheKey(input);
      expect(service.generateCacheKey({ ...input, temperature: 0.8 })).not.toBe(base);
      expect(service.generateCacheKey({ ...input, agentVersionId: 'ver-2' })).not.toBe(base);
      expect(service.generateCacheKey({ ...input, messages: [{ role: 'user', content: 'bye' }] })).not.toBe(base);
    });
  });

  describe('set', () => {
    it('defaults to a 24 hour expiry', async () => {
      await service.set('key-1', response);

      expect(db.llmResponseCache.upsert).toHaveBeenCalledWith({
        where: { cacheKey: 'key-1' },
        create: {
          cacheKey: 'key-1',
          response,
          expiresAt: new Date(NOW.getTime() + DEFAULT_CACHE_TTL_SECONDS * 1000),
        },
        update: {
          response,
          expiresAt: new Date(NOW.getTime() + DEFAULT_CACHE_TTL_SECONDS * 1000),
          hitCount: 0,
        },
      });
    });

    it('honours a custom TTL in seconds', async () => {
      await service.set('key-1', response, 15);

      expect(db.llmResponseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ expiresAt: new Date(NOW.getTime() + 15_000) }),
          update: expect.objectContaining({ expiresAt: new Date(NOW.getTime() + 15_000) }),
        }),
      );
    });

    it('overwrites an expired row instead of colliding on the unique cacheKey', async () => {
      await service.set('key-1', response, 15);

      // An expired row still occupies the key — get() filters it out but the DB
      // still holds it, so a plain create() would violate the unique constraint.
      expect(db.llmResponseCache.upsert).toHaveBeenCalledTimes(1);
      expect(db.llmResponseCache.upsert.mock.calls[0][0].where).toEqual({ cacheKey: 'key-1' });
    });

    it('writes nothing when the TTL is zero', async () => {
      await service.set('key-1', response, 0);

      expect(db.llmResponseCache.upsert).not.toHaveBeenCalled();
    });

    it('writes nothing when the TTL is negative', async () => {
      await service.set('key-1', response, -5);

      expect(db.llmResponseCache.upsert).not.toHaveBeenCalled();
    });

    it('writes nothing when the response text is empty', async () => {
      await service.set('key-1', { ...response, text: '' });
      expect(db.llmResponseCache.upsert).not.toHaveBeenCalled();
    });

    it('writes nothing when the response text is only whitespace', async () => {
      await service.set('key-1', { ...response, text: '   \n  ' });
      expect(db.llmResponseCache.upsert).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns null on a miss and does not bump hit count', async () => {
      expect(await service.get('key-1')).toBeNull();
      expect(db.llmResponseCache.update).not.toHaveBeenCalled();
    });

    it('only matches entries that have not expired', async () => {
      await service.get('key-1');

      expect(db.llmResponseCache.findFirst).toHaveBeenCalledWith({
        where: { cacheKey: 'key-1', expiresAt: { gt: NOW } },
      });
    });

    it('returns the response and increments hit count on a hit', async () => {
      db.llmResponseCache.findFirst.mockResolvedValue({ id: 'row-1', response, hitCount: 3 });

      expect(await service.get('key-1')).toEqual(response);
      expect(db.llmResponseCache.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { hitCount: { increment: 1 } },
      });
    });
  });

  describe('cleanupExpired', () => {
    it('deletes rows past their expiry and returns the count', async () => {
      db.llmResponseCache.deleteMany.mockResolvedValue({ count: 7 });

      expect(await service.cleanupExpired()).toBe(7);
      expect(db.llmResponseCache.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: NOW } },
      });
    });
  });
});
