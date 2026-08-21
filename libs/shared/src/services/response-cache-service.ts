import crypto from 'crypto';
import { DEFAULT_CACHE_TTL_SECONDS } from './caching-config';

export interface CacheDb {
  llmResponseCache: {
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CacheKeyInput {
  agentVersionId: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  temperature: number;
}

export interface CachedResponse {
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason?: string;
}

export class ResponseCacheService {
  constructor(private readonly db: CacheDb) {}

  generateCacheKey(input: CacheKeyInput): string {
    const data = JSON.stringify({
      agentVersionId: input.agentVersionId,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      model: input.model,
      temperature: input.temperature,
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async get(cacheKey: string): Promise<CachedResponse | null> {
    const entry = await this.db.llmResponseCache.findFirst({
      where: { cacheKey, expiresAt: { gt: new Date() } },
    }) as { response: CachedResponse; hitCount: number; id: string } | null;

    if (!entry) return null;

    await this.db.llmResponseCache.update({
      where: { id: entry.id },
      data: { hitCount: { increment: 1 } },
    });

    return entry.response;
  }

  async set(cacheKey: string, response: CachedResponse, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS): Promise<void> {
    if (ttlSeconds <= 0) return;
    if (!response.text || response.text.trim().length === 0) return;

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Upsert, not create: an expired row still occupies the unique cacheKey, and
    // get() cannot see it to reuse it.
    await this.db.llmResponseCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        response: response as unknown as Record<string, unknown>,
        expiresAt,
      },
      update: {
        response: response as unknown as Record<string, unknown>,
        expiresAt,
        hitCount: 0,
      },
    });
  }

  async invalidate(cacheKey: string): Promise<void> {
    await this.db.llmResponseCache.deleteMany({
      where: { cacheKey },
    });
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.db.llmResponseCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }) as { count: number };

    return result.count;
  }
}
