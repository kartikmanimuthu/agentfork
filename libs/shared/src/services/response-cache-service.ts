import crypto from 'crypto';

export interface CacheDb {
  llmResponseCache: {
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
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

const DEFAULT_TTL_HOURS = 24;

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

  async set(cacheKey: string, response: CachedResponse, ttlHours = DEFAULT_TTL_HOURS): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.db.llmResponseCache.create({
      data: {
        cacheKey,
        response: response as unknown as Record<string, unknown>,
        expiresAt,
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
