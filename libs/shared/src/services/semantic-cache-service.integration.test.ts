import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SemanticCacheService, type SemanticCacheDb } from './semantic-cache-service';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const response = { text: 'answer', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };

function vec(values: number[]): number[] {
  return values;
}

describeIfDb('SemanticCacheService against real PostgreSQL', () => {
  let db: PrismaClient;
  let service: SemanticCacheService;

  beforeAll(() => {
    db = new PrismaClient();
    service = new SemanticCacheService(db as unknown as SemanticCacheDb);
  });

  afterAll(async () => {
    await db.$executeRaw`DELETE FROM llm_semantic_cache WHERE "tenantId" LIKE 'itest-%'`;
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM llm_semantic_cache WHERE "tenantId" LIKE 'itest-%'`;
  });

  it('stores and retrieves an identical vector at similarity 1', async () => {
    await service.store({
      scopeKey: 'scope-a', tenantId: 'itest-1', agentVersionId: 'v1',
      promptText: 'how do I reset my password', embedding: vec([1, 0, 0]),
      embeddingModel: 'test-model', response, ttlSeconds: 3600,
    });

    const hit = await service.lookup({
      scopeKey: 'scope-a', embedding: vec([1, 0, 0]),
      promptText: 'how do I reset my password', threshold: 0.97,
    });

    expect(hit).not.toBeNull();
    expect(hit!.similarity).toBeCloseTo(1, 5);
    expect(hit!.response.text).toBe('answer');
  });

  it('does not return rows belonging to another scope', async () => {
    await service.store({
      scopeKey: 'scope-a', tenantId: 'itest-1', agentVersionId: 'v1',
      promptText: 'shared question', embedding: vec([1, 0, 0]),
      embeddingModel: 'test-model', response, ttlSeconds: 3600,
    });

    const hit = await service.lookup({
      scopeKey: 'scope-b', embedding: vec([1, 0, 0]),
      promptText: 'shared question', threshold: 0.5,
    });

    expect(hit).toBeNull();
  });

  it('does not return expired rows', async () => {
    await db.$executeRaw`
      INSERT INTO llm_semantic_cache
        (id,"scopeKey","tenantId","agentVersionId","promptText",embedding,"embeddingModel","embeddingDims",response,"hitCount","expiresAt","createdAt")
      VALUES ('itest-expired','scope-a','itest-1','v1','old', '[1,0,0]'::vector,'test-model',3,'{}'::jsonb,0, now() - interval '1 minute', now())
    `;

    const hit = await service.lookup({
      scopeKey: 'scope-a', embedding: vec([1, 0, 0]), promptText: 'old', threshold: 0.5,
    });

    expect(hit).toBeNull();
  });

  it('stores rows of different dimensions in the same column', async () => {
    await service.store({
      scopeKey: 'scope-1024', tenantId: 'itest-2', agentVersionId: 'v1',
      promptText: 'three dims', embedding: vec([1, 0, 0]),
      embeddingModel: 'model-a', response, ttlSeconds: 3600,
    });
    await service.store({
      scopeKey: 'scope-1536', tenantId: 'itest-2', agentVersionId: 'v1',
      promptText: 'five dims', embedding: vec([1, 0, 0, 0, 0]),
      embeddingModel: 'model-b', response, ttlSeconds: 3600,
    });

    const rows = await db.$queryRaw<Array<{ embeddingDims: number }>>`
      SELECT "embeddingDims" FROM llm_semantic_cache WHERE "tenantId" = 'itest-2' ORDER BY "embeddingDims"
    `;
    expect(rows.map((r) => Number(r.embeddingDims))).toEqual([3, 5]);
  });

  it('cleanupExpired removes only expired rows', async () => {
    await service.store({
      scopeKey: 'scope-a', tenantId: 'itest-3', agentVersionId: 'v1',
      promptText: 'fresh', embedding: vec([1, 0, 0]),
      embeddingModel: 'test-model', response, ttlSeconds: 3600,
    });
    await db.$executeRaw`
      INSERT INTO llm_semantic_cache
        (id,"scopeKey","tenantId","agentVersionId","promptText",embedding,"embeddingModel","embeddingDims",response,"hitCount","expiresAt","createdAt")
      VALUES ('itest-old','scope-a','itest-3','v1','stale','[1,0,0]'::vector,'test-model',3,'{}'::jsonb,0, now() - interval '1 minute', now())
    `;

    await service.cleanupExpired();

    const remaining = await db.$queryRaw<Array<{ promptText: string }>>`
      SELECT "promptText" FROM llm_semantic_cache WHERE "tenantId" = 'itest-3'
    `;
    expect(remaining.map((r) => r.promptText)).toEqual(['fresh']);
  });
});
