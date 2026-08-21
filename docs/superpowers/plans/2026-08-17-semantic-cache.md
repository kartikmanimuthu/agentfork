# Semantic Response Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second cache tier to the inference API that serves a stored answer when a new prompt means the same thing as an earlier one, using pgvector on the existing PostgreSQL.

**Architecture:** A new `llm_semantic_cache` table holds prompt embeddings and responses, partitioned by a `scopeKey` that hashes the agent version, system prompt, model, temperature and embedding model. `SemanticCacheService` owns the raw SQL. The inference route consults it only after the existing exact-match cache misses. Every failure path falls through to the LLM.

**Tech Stack:** TypeScript, Prisma 6, PostgreSQL 16 + pgvector 0.8.2, Vitest, Next.js 15 App Router, TanStack Form, shadcn/ui, pg-boss.

**Spec:** `docs/superpowers/specs/semantic-cache-design.md`

## Global Constraints

- Vector column is `Unsupported("vector")` — **no fixed dimension, no HNSW index**. See the spec's "Why there is no HNSW index" before adding one.
- Every generated Prisma migration emits spurious `DROP INDEX "claw_memories_embedding_hnsw"` and `DROP INDEX "idx_document_chunks_embedding"`. **Delete those lines before committing.** Verify with `bun run check:db`.
- Threshold is a **similarity** (higher is stricter), range `0.90`–`0.99`, default `0.97`. Do not copy Azure's `0.05`, which is a distance.
- TTL is shared with the exact tier: request `cacheTtlMinutes` → agent `cacheTtlMinutes` → `DEFAULT_TTL_MINUTES` (1440). No separate semantic TTL.
- The semantic tier **fails open**. Any error logs at `warn` and falls through to the LLM. It must never produce a non-2xx response.
- Never store an empty or whitespace-only response, in either tier.
- All logging uses the shared Pino logger with structured context (`{ tenantId, agentId, ... }`), never bare strings.
- All new env vars go through `apps/web-ui/lib/env.ts` (T3 Env). Never read `process.env` directly.
- Use `python3`/`pip3` never bare `python`; run tests with `bunx nx test <project>`.

---

### Task 1: Scope key and similarity logic (pure functions, no DB)

The parts that can be tested without a database. Isolating them first means the SQL task has a smaller surface.

**Files:**
- Create: `libs/shared/src/services/semantic-cache-service.ts`
- Test: `libs/shared/src/services/semantic-cache-service.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `buildScopeKey(input: ScopeKeyInput): string`
  - `extractDigits(text: string): string[]`
  - `digitsMatch(a: string, b: string): boolean`
  - `DEFAULT_SIMILARITY_THRESHOLD = 0.97`, `MIN_SIMILARITY_THRESHOLD = 0.90`, `MAX_SIMILARITY_THRESHOLD = 0.99`
  - `interface ScopeKeyInput { agentVersionId: string; systemPrompt: string; model: string; temperature: number; embeddingModel: string }`

- [ ] **Step 1: Write the failing test**

```ts
// libs/shared/src/services/semantic-cache-service.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildScopeKey,
  extractDigits,
  digitsMatch,
  DEFAULT_SIMILARITY_THRESHOLD,
  MIN_SIMILARITY_THRESHOLD,
  MAX_SIMILARITY_THRESHOLD,
} from './semantic-cache-service';

const base = {
  agentVersionId: 'ver-1',
  systemPrompt: 'You are helpful.',
  model: 'anthropic.claude-sonnet-4-20250514',
  temperature: 0.7,
  embeddingModel: 'amazon.titan-embed-text-v2:0',
};

describe('buildScopeKey', () => {
  it('is stable for identical input', () => {
    expect(buildScopeKey(base)).toBe(buildScopeKey({ ...base }));
  });

  it('changes when any component changes', () => {
    const original = buildScopeKey(base);
    expect(buildScopeKey({ ...base, agentVersionId: 'ver-2' })).not.toBe(original);
    expect(buildScopeKey({ ...base, systemPrompt: 'Be terse.' })).not.toBe(original);
    expect(buildScopeKey({ ...base, model: 'other-model' })).not.toBe(original);
    expect(buildScopeKey({ ...base, temperature: 0.8 })).not.toBe(original);
    expect(buildScopeKey({ ...base, embeddingModel: 'text-embedding-3-large' })).not.toBe(original);
  });

  it('returns a hex sha256', () => {
    expect(buildScopeKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('extractDigits', () => {
  it('returns digit runs in order', () => {
    expect(extractDigits('show Q3 revenue for 2025')).toEqual(['3', '2025']);
  });

  it('returns an empty array when there are no digits', () => {
    expect(extractDigits('how do I reset my password')).toEqual([]);
  });
});

describe('digitsMatch', () => {
  it('accepts prompts with no digits', () => {
    expect(digitsMatch('reset my password', 'reset the password')).toBe(true);
  });

  it('accepts identical digits', () => {
    expect(digitsMatch('status of order 4821', 'order 4821 status')).toBe(true);
  });

  it('rejects different digits', () => {
    expect(digitsMatch('show Q3 revenue', 'show Q4 revenue')).toBe(false);
  });

  it('rejects reordered digits', () => {
    expect(digitsMatch('transfer 500 to 200', 'transfer 200 to 500')).toBe(false);
  });

  it('rejects when one side has digits and the other does not', () => {
    expect(digitsMatch('invoice 77', 'invoice')).toBe(false);
  });
});

describe('threshold constants', () => {
  it('exposes a strict default inside the allowed range', () => {
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.97);
    expect(MIN_SIMILARITY_THRESHOLD).toBe(0.9);
    expect(MAX_SIMILARITY_THRESHOLD).toBe(0.99);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/semantic-cache-service.test.ts`
Expected: FAIL — `Failed to resolve import "./semantic-cache-service"`

- [ ] **Step 3: Write minimal implementation**

```ts
// libs/shared/src/services/semantic-cache-service.ts
import crypto from 'crypto';

export const DEFAULT_SIMILARITY_THRESHOLD = 0.97;
export const MIN_SIMILARITY_THRESHOLD = 0.9;
export const MAX_SIMILARITY_THRESHOLD = 0.99;

export interface ScopeKeyInput {
  agentVersionId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  embeddingModel: string;
}

export function buildScopeKey(input: ScopeKeyInput): string {
  const data = JSON.stringify({
    agentVersionId: input.agentVersionId,
    systemPrompt: input.systemPrompt,
    model: input.model,
    temperature: input.temperature,
    embeddingModel: input.embeddingModel,
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function extractDigits(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

// Ordered, not set-based: "transfer 500 to 200" must not match "transfer 200 to 500".
export function digitsMatch(a: string, b: string): boolean {
  const left = extractDigits(a);
  const right = extractDigits(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/semantic-cache-service.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/services/semantic-cache-service.ts libs/shared/src/services/semantic-cache-service.test.ts
git commit -m "feat(cache): scope key and numeric guard for semantic cache"
```

---

### Task 2: Prisma model and migration

**Files:**
- Modify: `prisma/schema.prisma` (add model after `LlmResponseCache`, which ends at line 727)
- Create: `prisma/migrations/<timestamp>_add_llm_semantic_cache/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: table `llm_semantic_cache`; Prisma client accessor `db.llmSemanticCache`.

- [ ] **Step 1: Add the model to the schema**

```prisma
model LlmSemanticCache {
  id             String   @id @default(cuid())
  scopeKey       String
  tenantId       String
  agentVersionId String
  promptText     String
  embedding      Unsupported("vector")?
  embeddingModel String
  embeddingDims  Int
  response       Json
  hitCount       Int      @default(0)
  expiresAt      DateTime
  createdAt      DateTime @default(now())

  @@index([scopeKey, expiresAt])
  @@map("llm_semantic_cache")
}
```

- [ ] **Step 2: Generate the migration without applying it**

Run: `bunx prisma migrate dev --create-only --name add_llm_semantic_cache --schema=./prisma/schema.prisma`
Expected: a new folder under `prisma/migrations/`.

- [ ] **Step 3: Strip the spurious DROP INDEX lines**

Open the generated `migration.sql`. Delete any line matching:

```sql
DROP INDEX "claw_memories_embedding_hnsw";
DROP INDEX "idx_document_chunks_embedding";
```

Prisma emits these because it cannot model HNSW indexes on `Unsupported("vector(...)")` columns and reads them as drift. Shipping them silently degrades memory recall and knowledge-base search. The remaining SQL should only `CREATE TABLE "llm_semantic_cache"` and `CREATE INDEX` on `(scopeKey, expiresAt)`.

- [ ] **Step 4: Apply and verify**

Run:
```bash
bunx prisma migrate deploy --schema=./prisma/schema.prisma
bunx prisma generate --schema=./prisma/schema.prisma
bun run check:db
```
Expected: migration applies; `check:db` reports the vector indexes still present.

- [ ] **Step 5: Verify mixed dimensions are accepted**

Run:
```bash
docker exec chatbot-postgres psql -U chatbot_admin -d chatbot -c \
  "INSERT INTO llm_semantic_cache (id,\"scopeKey\",\"tenantId\",\"agentVersionId\",\"promptText\",embedding,\"embeddingModel\",\"embeddingDims\",response,\"expiresAt\") VALUES ('t1','s','t','v','p','[1,2,3]','m',3,'{}'::jsonb,now()+interval '1 hour'), ('t2','s','t','v','p','[1,2,3,4,5]','m',5,'{}'::jsonb,now()+interval '1 hour'); SELECT id, vector_dims(embedding) FROM llm_semantic_cache; DELETE FROM llm_semantic_cache WHERE id IN ('t1','t2');"
```
Expected: two rows reporting dims 3 and 5, proving the dimensionless column works.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add llm_semantic_cache table"
```

---

### Task 3: SemanticCacheService lookup and store

**Files:**
- Modify: `libs/shared/src/services/semantic-cache-service.ts`
- Modify: `libs/shared/src/services/semantic-cache-service.test.ts`
- Modify: `libs/shared/src/index.ts:53` (export block area)

**Interfaces:**
- Consumes: `buildScopeKey`, `digitsMatch` from Task 1; table from Task 2.
- Produces:
  - `class SemanticCacheService { constructor(db: SemanticCacheDb); lookup(params: LookupParams): Promise<SemanticHit | null>; store(params: StoreParams): Promise<void>; cleanupExpired(): Promise<number> }`
  - `interface SemanticHit { id: string; response: CachedResponse; promptText: string; similarity: number }`
  - `interface LookupParams { scopeKey: string; embedding: number[]; promptText: string; threshold: number }`
  - `interface StoreParams { scopeKey: string; tenantId: string; agentVersionId: string; promptText: string; embedding: number[]; embeddingModel: string; response: CachedResponse; ttlMinutes: number }`

- [ ] **Step 1: Write the failing test**

Append to `semantic-cache-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SemanticCacheService, type SemanticCacheDb } from './semantic-cache-service';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const response = { text: 'Go to Settings > Security.', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };

function makeDb() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    llmSemanticCache: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as SemanticCacheDb & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    llmSemanticCache: Record<string, ReturnType<typeof vi.fn>>;
  };
}

describe('SemanticCacheService', () => {
  let db: ReturnType<typeof makeDb>;
  let service: SemanticCacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db = makeDb();
    service = new SemanticCacheService(db);
  });

  afterEach(() => vi.useRealTimers());

  describe('lookup', () => {
    it('returns null when nothing is found', async () => {
      const hit = await service.lookup({ scopeKey: 's1', embedding: [0.1, 0.2], promptText: 'hello', threshold: 0.97 });
      expect(hit).toBeNull();
    });

    it('returns null when similarity is below the threshold', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'hi there', similarity: 0.95 },
      ]);
      const hit = await service.lookup({ scopeKey: 's1', embedding: [0.1], promptText: 'hello', threshold: 0.97 });
      expect(hit).toBeNull();
    });

    it('returns the row when similarity meets the threshold exactly', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.97 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'reset my password', threshold: 0.97,
      });
      expect(hit).toEqual({ id: 'r1', response, promptText: 'reset the password', similarity: 0.97 });
    });

    it('rejects a high-similarity row whose digits differ', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'show Q4 revenue', similarity: 0.99 },
      ]);
      const hit = await service.lookup({
        scopeKey: 's1', embedding: [0.1], promptText: 'show Q3 revenue', threshold: 0.97,
      });
      expect(hit).toBeNull();
    });

    it('increments hitCount on a hit', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'r1', response, prompt_text: 'reset the password', similarity: 0.99 },
      ]);
      await service.lookup({ scopeKey: 's1', embedding: [0.1], promptText: 'reset my password', threshold: 0.97 });
      expect(db.llmSemanticCache.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { hitCount: { increment: 1 } },
      });
    });
  });

  describe('store', () => {
    const storeParams = {
      scopeKey: 's1',
      tenantId: 't1',
      agentVersionId: 'v1',
      promptText: 'how do I reset my password',
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      response,
      ttlMinutes: 60,
    };

    it('writes a row with measured dimensions and the correct expiry', async () => {
      await service.store(storeParams);
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);
      const args = db.$executeRaw.mock.calls[0];
      expect(JSON.stringify(args)).toContain('llm_semantic_cache');
    });

    it('writes nothing when the TTL is zero or negative', async () => {
      await service.store({ ...storeParams, ttlMinutes: 0 });
      await service.store({ ...storeParams, ttlMinutes: -5 });
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('writes nothing when the response text is empty or whitespace', async () => {
      await service.store({ ...storeParams, response: { ...response, text: '' } });
      await service.store({ ...storeParams, response: { ...response, text: '   ' } });
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('writes nothing when the embedding is empty', async () => {
      await service.store({ ...storeParams, embedding: [] });
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpired', () => {
    it('deletes expired rows and returns the count', async () => {
      db.llmSemanticCache.deleteMany.mockResolvedValue({ count: 4 });
      expect(await service.cleanupExpired()).toBe(4);
      expect(db.llmSemanticCache.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: NOW } },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/semantic-cache-service.test.ts`
Expected: FAIL — `SemanticCacheService is not a constructor` / not exported

- [ ] **Step 3: Write the implementation**

Append to `libs/shared/src/services/semantic-cache-service.ts`:

```ts
import { createLogger } from '../logging/logger';
import type { CachedResponse } from './response-cache-service';

const log = createLogger('semantic-cache');

export type { CachedResponse };

export interface SemanticCacheDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  llmSemanticCache: {
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface SemanticHit {
  id: string;
  response: CachedResponse;
  promptText: string;
  similarity: number;
}

export interface LookupParams {
  scopeKey: string;
  embedding: number[];
  promptText: string;
  threshold: number;
}

export interface StoreParams {
  scopeKey: string;
  tenantId: string;
  agentVersionId: string;
  promptText: string;
  embedding: number[];
  embeddingModel: string;
  response: CachedResponse;
  ttlMinutes: number;
}

interface LookupRow {
  id: string;
  response: CachedResponse;
  prompt_text: string;
  similarity: number;
}

export class SemanticCacheService {
  constructor(private readonly db: SemanticCacheDb) {}

  async lookup(params: LookupParams): Promise<SemanticHit | null> {
    if (params.embedding.length === 0) return null;

    const vector = `[${params.embedding.join(',')}]`;

    const rows = await this.db.$queryRaw<LookupRow[]>`
      SELECT
        id,
        response,
        "promptText" AS prompt_text,
        1 - (embedding <=> ${vector}::vector) AS similarity
      FROM llm_semantic_cache
      WHERE "scopeKey" = ${params.scopeKey}
        AND "expiresAt" > now()
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vector}::vector
      LIMIT 1
    `;

    const candidate = rows[0];
    if (!candidate) return null;

    const similarity = Number(candidate.similarity);

    // Near-miss logging is the dataset used to decide whether the threshold should move.
    if (similarity < params.threshold) {
      if (similarity >= params.threshold - 0.05) {
        log.debug(
          {
            similarity,
            threshold: params.threshold,
            promptText: params.promptText,
            candidatePromptText: candidate.prompt_text,
          },
          'Semantic cache near miss',
        );
      }
      return null;
    }

    if (!digitsMatch(params.promptText, candidate.prompt_text)) {
      log.debug(
        {
          similarity,
          promptText: params.promptText,
          candidatePromptText: candidate.prompt_text,
        },
        'Semantic cache candidate rejected by numeric guard',
      );
      return null;
    }

    await this.db.llmSemanticCache.update({
      where: { id: candidate.id },
      data: { hitCount: { increment: 1 } },
    });

    return {
      id: candidate.id,
      response: candidate.response,
      promptText: candidate.prompt_text,
      similarity,
    };
  }

  async store(params: StoreParams): Promise<void> {
    if (params.ttlMinutes <= 0) return;
    if (params.embedding.length === 0) return;
    if (!params.response.text || params.response.text.trim().length === 0) return;

    const vector = `[${params.embedding.join(',')}]`;
    const expiresAt = new Date(Date.now() + params.ttlMinutes * 60 * 1000);
    const id = crypto.randomUUID();

    await this.db.$executeRaw`
      INSERT INTO llm_semantic_cache
        (id, "scopeKey", "tenantId", "agentVersionId", "promptText", embedding,
         "embeddingModel", "embeddingDims", response, "hitCount", "expiresAt", "createdAt")
      VALUES
        (${id}, ${params.scopeKey}, ${params.tenantId}, ${params.agentVersionId},
         ${params.promptText}, ${vector}::vector, ${params.embeddingModel},
         ${params.embedding.length}, ${JSON.stringify(params.response)}::jsonb,
         0, ${expiresAt}, now())
    `;
  }

  async cleanupExpired(): Promise<number> {
    const result = (await this.db.llmSemanticCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })) as { count: number };
    return result.count;
  }
}
```

Raw SQL is used for the insert because Prisma's typed client cannot write to an `Unsupported("vector")` column.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/semantic-cache-service.test.ts`
Expected: PASS

- [ ] **Step 5: Export from the shared barrel**

In `libs/shared/src/index.ts`, beside the existing `ResponseCacheService` export:

```ts
export {
  SemanticCacheService,
  buildScopeKey,
  DEFAULT_SIMILARITY_THRESHOLD,
  MIN_SIMILARITY_THRESHOLD,
  MAX_SIMILARITY_THRESHOLD,
} from './services/semantic-cache-service';
export type { SemanticHit, LookupParams, StoreParams } from './services/semantic-cache-service';
```

- [ ] **Step 6: Verify the project still builds**

Run: `bunx nx test shared && bunx nx run-many -t typecheck -p shared`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/services/semantic-cache-service.ts libs/shared/src/services/semantic-cache-service.test.ts libs/shared/src/index.ts
git commit -m "feat(cache): semantic cache lookup and store"
```

- [ ] **Step 8: Write the failing test for the exact tier's empty-response guard**

The spec requires this guard on **both** tiers. The exact tier does not have it: a failed provider call is currently recorded as `completed` with `text: ""` and cached. Add to `libs/shared/src/services/response-cache-service.test.ts`, inside the existing `describe('set', ...)`:

```ts
    it('writes nothing when the response text is empty', async () => {
      await service.set('key-1', { ...response, text: '' });
      expect(db.llmResponseCache.upsert).not.toHaveBeenCalled();
    });

    it('writes nothing when the response text is only whitespace', async () => {
      await service.set('key-1', { ...response, text: '   \n  ' });
      expect(db.llmResponseCache.upsert).not.toHaveBeenCalled();
    });
```

- [ ] **Step 9: Run it to verify it fails**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/response-cache-service.test.ts`
Expected: FAIL — both new tests, because `upsert` is called.

- [ ] **Step 10: Add the guard**

In `libs/shared/src/services/response-cache-service.ts`, in `set()`, directly below the existing `if (ttlMinutes <= 0) return;`:

```ts
    if (!response.text || response.text.trim().length === 0) return;
```

- [ ] **Step 11: Run the full shared suite**

Run: `bunx nx test shared`
Expected: PASS, including the two new tests.

- [ ] **Step 12: Commit**

```bash
git add libs/shared/src/services/response-cache-service.ts libs/shared/src/services/response-cache-service.test.ts
git commit -m "fix(cache): never cache an empty response"
```

---

### Task 4: Real-database integration test

The unit tests mock `$queryRaw`, so they prove none of the SQL. This task proves the SQL, including the multi-tenant isolation property.

**Files:**
- Create: `libs/shared/src/services/semantic-cache-service.integration.test.ts`

**Interfaces:**
- Consumes: `SemanticCacheService` from Task 3, table from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test**

```ts
// libs/shared/src/services/semantic-cache-service.integration.test.ts
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
      embeddingModel: 'test-model', response, ttlMinutes: 60,
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
      embeddingModel: 'test-model', response, ttlMinutes: 60,
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
      embeddingModel: 'model-a', response, ttlMinutes: 60,
    });
    await service.store({
      scopeKey: 'scope-1536', tenantId: 'itest-2', agentVersionId: 'v1',
      promptText: 'five dims', embedding: vec([1, 0, 0, 0, 0]),
      embeddingModel: 'model-b', response, ttlMinutes: 60,
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
      embeddingModel: 'test-model', response, ttlMinutes: 60,
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
```

- [ ] **Step 2: Run against the local database**

Run:
```bash
docker compose up -d
bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/semantic-cache-service.integration.test.ts
```
Expected: 5 passing. If `DATABASE_URL` is unset the suite skips — confirm it actually ran, don't accept a skip as a pass.

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/services/semantic-cache-service.integration.test.ts
git commit -m "test(cache): real-database coverage for semantic cache SQL"
```

---

### Task 5: Agent config type and platform kill switch

**Files:**
- Modify: `libs/agent-studio/src/types/agent.ts:40-50` (`SimpleAgentConfig`)
- Modify: `apps/web-ui/lib/env.ts:30` (server block)

**Interfaces:**
- Consumes: nothing.
- Produces: `SimpleAgentConfig.semanticCache?: { enabled: boolean; embeddingModel: string; threshold: number }`; `env.SEMANTIC_CACHE_ENABLED: boolean`.

- [ ] **Step 1: Extend the config type**

In `libs/agent-studio/src/types/agent.ts`, inside `SimpleAgentConfig`, after `cacheTtlMinutes`:

```ts
  /** Semantic (meaning-based) cache. Only applies to stateless, tool-free calls. */
  semanticCache?: {
    enabled: boolean;
    embeddingModel: string;
    threshold: number;
  };
```

- [ ] **Step 2: Add the kill switch**

In `apps/web-ui/lib/env.ts`, in the `server` block after `MISSION_CONTROL_URL`:

```ts
    SEMANTIC_CACHE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
```

- [ ] **Step 3: Verify typecheck**

Run: `bunx nx run-many -t typecheck -p agent-studio,web-ui`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/types/agent.ts apps/web-ui/lib/env.ts
git commit -m "feat(cache): semantic cache agent config and kill switch"
```

---

### Task 6: Embedding validation endpoint

**Files:**
- Create: `apps/web-ui/app/api/agents/embedding-check/route.ts`

**Interfaces:**
- Consumes: `generateEmbedding` from `@chatbot/ai`, `LlmProviderService` from `@chatbot/shared`.
- Produces: `POST /api/agents/embedding-check` → `200 { ok: true, dimensions: number }` or `400 { ok: false, error: string }`.

- [ ] **Step 1: Write the route**

```ts
// apps/web-ui/app/api/agents/embedding-check/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions, createLogger, LlmProviderService } from '@chatbot/shared';
import { generateEmbedding, createLLMProvider } from '@chatbot/ai';

const logger = createLogger('api:agents:embedding-check');

const bodySchema = z.object({
  embeddingModel: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = req.headers.get('x-tenant-id');

    if (!session || !tenantId) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }

    const { embeddingModel } = parsed.data;

    const providerService = new LlmProviderService(tenantId);
    const providers = await providerService.list();
    const owning = providers.find((provider) => {
      const discovered = (provider.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
      return discovered.some((model) => model.id === embeddingModel) || provider.embeddingModel === embeddingModel;
    });

    if (!owning) {
      logger.warn({ tenantId, embeddingModel }, 'Embedding model not offered by any configured provider');
      return Response.json(
        { ok: false, error: 'That embedding model is not offered by any provider you have configured.' },
        { status: 400 },
      );
    }

    const config = await providerService.getConfigById(owning.id);
    const provider = config ? createLLMProvider(config) : undefined;
    const vector = await generateEmbedding('semantic cache validation probe', provider);

    if (!Array.isArray(vector) || vector.length === 0) {
      logger.warn({ tenantId, embeddingModel }, 'Embedding model returned an empty vector');
      return Response.json(
        { ok: false, error: 'That model did not return an embedding. Pick a different model.' },
        { status: 400 },
      );
    }

    logger.info({ tenantId, embeddingModel, dimensions: vector.length }, 'Embedding model validated');
    return Response.json({ ok: true, dimensions: vector.length });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ errorMessage: error.message, errorStack: error.stack }, 'Embedding check failed');
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
}
```

The catch returns 400 rather than 500 deliberately: the common failure is a bad model or missing credentials, and the tenant needs to read the provider's own message.

- [ ] **Step 2: Verify the import names resolve**

Run: `bunx nx run-many -t typecheck -p web-ui`
Expected: PASS. If `createLLMProvider` or `authOptions` is not exported from the barrel used here, correct the import path to match the codebase rather than adding a new export.

- [ ] **Step 3: Manual check against the dev server**

Run:
```bash
curl -s -X POST http://localhost:3005/api/agents/embedding-check \
  -H 'Content-Type: application/json' -d '{"embeddingModel":"not-a-real-model"}'
```
Expected: `401` unauthenticated, or `400` with a readable message when called with a session. Confirm it never returns 500.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/agents/embedding-check/route.ts
git commit -m "feat(cache): embedding model validation endpoint"
```

---

### Task 7: Wire the semantic tier into the inference route

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts` — imports at lines 2-20, `simpleConfig` cast at line 416, cache block at lines 467-520, write sites at lines 737, 805, 874

**Interfaces:**
- Consumes: `SemanticCacheService`, `buildScopeKey` (Task 3); `semanticCache` config (Task 5); `generateEmbedding` from `@chatbot/ai`.
- Produces: response field `cacheType: 'exact' | 'semantic'`.

- [ ] **Step 1: Extend imports and the config cast**

Add to the `@chatbot/shared` import block:

```ts
  SemanticCacheService,
  buildScopeKey,
  DEFAULT_SIMILARITY_THRESHOLD,
```

Add `generateEmbedding` to the existing `@chatbot/ai` import block. Add `import { env } from '@/lib/env';` if not already present.

Replace the cast at line 416 with:

```ts
      const simpleConfig = config as {
        model?: string;
        systemPrompt?: string;
        temperature?: number;
        maxTokens?: number;
        cacheTtlMinutes?: number;
        semanticCache?: { enabled: boolean; embeddingModel: string; threshold: number };
      };
```

- [ ] **Step 2: Add the semantic tier after the exact-cache block**

Immediately after the closing brace of the `if (cacheEligible) { ... }` exact-cache block (currently ending near line 520), insert:

```ts
      const semanticConfig = simpleConfig.semanticCache;
      const semanticEnabled =
        env.SEMANTIC_CACHE_ENABLED &&
        cacheEligible &&
        semanticConfig?.enabled === true &&
        !!semanticConfig.embeddingModel;

      const semanticService = new SemanticCacheService(db as never);
      const lastUserMessage = [...coreMessages].reverse().find((m) => m.role === 'user');
      const semanticPromptText =
        typeof lastUserMessage?.content === 'string'
          ? lastUserMessage.content
          : (lastUserMessage?.content ?? [])
              .filter((part: { type: string }) => part.type === 'text')
              .map((part: { text?: string }) => part.text ?? '')
              .join(' ');

      let semanticScopeKey: string | null = null;
      let semanticEmbedding: number[] | null = null;

      if (semanticEnabled && semanticPromptText.trim().length > 0) {
        try {
          semanticScopeKey = buildScopeKey({
            agentVersionId: version.id,
            systemPrompt: effectiveSystem,
            model: effectiveModel ?? 'default',
            temperature: effectiveTemperature,
            embeddingModel: semanticConfig!.embeddingModel,
          });

          semanticEmbedding = await generateEmbedding(semanticPromptText);

          const threshold = semanticConfig!.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
          const hit = await semanticService.lookup({
            scopeKey: semanticScopeKey,
            embedding: semanticEmbedding,
            promptText: semanticPromptText,
            threshold,
          });

          if (hit) {
            logger.info(
              {
                tenantId, agentId, cacheEntryId: hit.id,
                similarity: hit.similarity, threshold,
                promptText: semanticPromptText, cachedPromptText: hit.promptText,
              },
              'Semantic cache hit',
            );

            await mcpCleanup();
            await quotaService.incrementUsage(hit.response.usage.totalTokens);
            await db.apiKeyExecution.update({
              where: { id: executionId },
              data: {
                status: 'completed',
                output: { text: hit.response.text },
                tokenUsage: hit.response.usage as never,
                cacheHit: true,
                cacheType: 'semantic',
                completedAt: new Date(),
              },
            });

            await deliverWebhook('completed', { text: hit.response.text }, undefined, hit.response.usage, 0);

            return new Response(
              JSON.stringify({
                id: executionId,
                content: hit.response.text,
                usage: hit.response.usage,
                cacheHit: true,
                cacheType: 'semantic',
              }),
              { headers: { 'Content-Type': 'application/json' } },
            );
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.warn(
            { tenantId, agentId, errorMessage: error.message },
            'Semantic cache unavailable — falling through to the model',
          );
          semanticEmbedding = null;
        }
      }
```

The `catch` sets `semanticEmbedding = null` so the write sites below also skip, and never rethrows. This is the fail-open requirement.

- [ ] **Step 3: Add semantic writes beside each existing exact write**

At each of the three sites (lines 737, 805, 874 before this task's edits), directly after the existing `cacheService.set(...)` call, add:

```ts
              if (semanticEnabled && semanticScopeKey && semanticEmbedding) {
                try {
                  await semanticService.store({
                    scopeKey: semanticScopeKey,
                    tenantId,
                    agentVersionId: version.id,
                    promptText: semanticPromptText,
                    embedding: semanticEmbedding,
                    embeddingModel: semanticConfig!.embeddingModel,
                    response: { text, usage: tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
                    ttlMinutes: effectiveCacheTtl,
                  });
                } catch (err) {
                  const error = err instanceof Error ? err : new Error(String(err));
                  logger.warn({ tenantId, agentId, errorMessage: error.message }, 'Semantic cache write failed');
                }
              }
```

At the SSE site use `fullText` and `sseTokenUsage` in place of `text` and `tokenUsage`, matching the surrounding code.

- [ ] **Step 4: Add `cacheType: 'exact'` to the existing exact-hit response**

In the exact-cache hit block, add `cacheType: 'exact'` to both the `apiKeyExecution.update` data and the JSON response body, beside the existing `cacheHit: true`.

- [ ] **Step 5: Add the `cacheType` column**

In `prisma/schema.prisma`, in `model ApiKeyExecution` (starts line 509), after the existing `cacheHit` field:

```prisma
  cacheType String?
```

Then:
```bash
bunx prisma migrate dev --create-only --name add_execution_cache_type --schema=./prisma/schema.prisma
```
Delete the two spurious `DROP INDEX` lines from the generated SQL, then:
```bash
bunx prisma migrate deploy --schema=./prisma/schema.prisma
bunx prisma generate --schema=./prisma/schema.prisma
bun run check:db
```

- [ ] **Step 6: Verify the route compiles and still fails closed on auth**

Run:
```bash
bunx nx run-many -t typecheck -p web-ui
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3005/api/v1/inference \
  -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'
```
Expected: typecheck passes; curl returns `401`.

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts prisma/schema.prisma prisma/migrations
git commit -m "feat(cache): consult semantic cache after exact-cache miss"
```

---

### Task 8: Agent form controls and eligibility warnings

**Files:**
- Modify: `apps/web-ui/components/agents/config/simple-agent-form.tsx`
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx:254` (pass the tool count)

**Interfaces:**
- Consumes: `semanticCache` config (Task 5), `/api/agents/embedding-check` (Task 6).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the form schema and defaults**

In `simple-agent-form.tsx`, add to the zod schema:

```ts
  semanticCacheEnabled: z.boolean().optional(),
  semanticCacheEmbeddingModel: z.string().optional(),
  semanticCacheThreshold: z.number().min(0.9).max(0.99).optional(),
```

Add to `defaultValues`:

```ts
      semanticCacheEnabled: config.semanticCache?.enabled ?? false,
      semanticCacheEmbeddingModel: config.semanticCache?.embeddingModel ?? '',
      semanticCacheThreshold: config.semanticCache?.threshold ?? 0.97,
```

Add to the `onSave` payload:

```ts
        semanticCache: value.semanticCacheEnabled
          ? {
              enabled: true,
              embeddingModel: value.semanticCacheEmbeddingModel ?? '',
              threshold: value.semanticCacheThreshold ?? 0.97,
            }
          : undefined,
```

- [ ] **Step 2: Add the prop for tool detection**

Change the props interface to:

```ts
interface SimpleAgentFormProps {
  config: SimpleAgentConfig;
  onSave: (config: SimpleAgentConfig) => void;
  saving?: boolean;
  attachedToolCount?: number;
}
```

and destructure `attachedToolCount = 0` in the signature. Compute:

```ts
  const builtInToolCount = config.tools?.length ?? 0;
  const totalToolCount = builtInToolCount + attachedToolCount;
```

- [ ] **Step 3: Render the controls**

Add before the submit button, importing `Switch` from `@/components/ui/switch`, `Alert`/`AlertTitle`/`AlertDescription` from `@/components/ui/alert`, and `ProviderModelSelect` (already imported):

```tsx
      <form.Field name="semanticCacheEnabled">
        {(field) => (
          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="grid gap-0.5">
                <Label htmlFor={field.name}>Semantic cache</Label>
                <p className="text-xs text-muted-foreground">
                  Reuse an answer when a new question means the same thing as an earlier one.
                </p>
              </div>
              <Switch
                id={field.name}
                checked={field.state.value ?? false}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
            </div>

            {field.state.value && (
              <>
                {totalToolCount > 0 && (
                  <Alert variant="destructive">
                    <AlertTitle>Nothing will be cached while tools are attached.</AlertTitle>
                    <AlertDescription>
                      Tools fetch live data and can perform actions such as creating a ticket. Reusing a saved answer
                      would skip them entirely, so this agent&apos;s responses are never cached. Caching applies to
                      agents that answer from their own knowledge.
                    </AlertDescription>
                  </Alert>
                )}

                <form.Field name="semanticCacheEmbeddingModel">
                  {(modelField) => (
                    <div className="grid gap-1.5">
                      <Label>Embedding model</Label>
                      <ProviderModelSelect
                        capability="embedding"
                        value={modelField.state.value ?? ''}
                        onChange={(v) => modelField.handleChange(v)}
                        placeholder="Select an embedding model"
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="semanticCacheThreshold">
                  {(thresholdField) => (
                    <div className="grid gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Match strictness</Label>
                        <span className="text-xs text-muted-foreground">{thresholdField.state.value ?? 0.97}</span>
                      </div>
                      <Slider
                        min={0.9}
                        max={0.99}
                        step={0.01}
                        value={[thresholdField.state.value ?? 0.97]}
                        onValueChange={(vals) => {
                          const v = Array.isArray(vals) ? vals[0] : (vals as number);
                          thresholdField.handleChange(v);
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Higher is stricter. 0.99 reuses an answer only for near-identical questions; 0.90 reuses more
                        often and risks a wrong match.
                      </p>
                    </div>
                  )}
                </form.Field>

                <p className="text-xs text-muted-foreground">
                  Answers are only reused for one-off questions. This agent will not reuse an answer when it uses tools,
                  when the request is part of an ongoing conversation, or when the caller asks for a fresh answer.
                </p>
              </>
            )}
          </div>
        )}
      </form.Field>
```

- [ ] **Step 4: Validate the embedding model on submit**

Wrap the existing `onSubmit` body so that when `semanticCacheEnabled` is true it first calls the check endpoint and aborts on failure:

```ts
    onSubmit: async ({ value }) => {
      if (value.semanticCacheEnabled) {
        if (!value.semanticCacheEmbeddingModel) {
          setSemanticError('Choose an embedding model before turning the semantic cache on.');
          return;
        }
        const res = await fetch('/api/agents/embedding-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeddingModel: value.semanticCacheEmbeddingModel }),
        });
        const body = await res.json();
        if (!body.ok) {
          setSemanticError(body.error ?? 'That embedding model could not be verified.');
          return;
        }
      }
      setSemanticError(null);
      onSave({
        model: value.model,
        systemPrompt: value.systemPrompt ?? '',
        temperature: value.temperature,
        maxTokens: value.maxTokens || undefined,
        cacheTtlMinutes: value.cacheTtlMinutes,
        semanticCache: value.semanticCacheEnabled
          ? {
              enabled: true,
              embeddingModel: value.semanticCacheEmbeddingModel ?? '',
              threshold: value.semanticCacheThreshold ?? 0.97,
            }
          : undefined,
        tools: config.tools ?? [],
      });
    },
```

Note that `onSubmit` becomes `async`. TanStack Form supports an async submit handler; the submit button already disables via the `saving` prop, so no extra pending state is needed.

Add `const [semanticError, setSemanticError] = useState<string | null>(null);` at the top of the component, importing `useState` from React, and render `semanticError` inside the bordered block as `<p className="text-xs text-destructive">{semanticError}</p>`.

- [ ] **Step 5: Pass the tool count from the edit page**

In `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx`, pass `attachedToolCount` to `SimpleAgentForm`. The MCP attachment count is not currently held by this page — read it from whatever the page already loads for the MCP tab; if no count is available without a new fetch, pass `0` and leave the persistent note to cover MCP, then record the gap in the PR description. Do not add a new fetch without checking whether the agent payload already carries the relation.

- [ ] **Step 6: Verify**

Run: `bunx nx run-many -t typecheck -p web-ui && bunx nx lint web-ui`
Expected: PASS. Then load `/agents/<id>/edit` in the browser, toggle the switch, and confirm the controls appear and the warning shows for an agent with tools.

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/components/agents/config/simple-agent-form.tsx "apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx"
git commit -m "feat(cache): semantic cache controls and eligibility warnings"
```

---

### Task 9: Read-only display on the agent detail page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx:137-150` (config card grid)

**Interfaces:**
- Consumes: `semanticCache` config (Task 5).
- Produces: nothing.

- [ ] **Step 1: Add the cell**

After the Cache TTL cell:

```tsx
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Semantic cache</span>
                <span>
                  {simpleConfig.semanticCache?.enabled
                    ? `On · ${simpleConfig.semanticCache.embeddingModel} · ${simpleConfig.semanticCache.threshold}`
                    : 'Off'}
                </span>
              </div>
```

- [ ] **Step 2: Add the eligibility note below the grid**

```tsx
            {simpleConfig.semanticCache?.enabled && (
              <p className="text-xs text-muted-foreground">
                Answers are only reused for one-off questions — never when this agent uses tools, when the request is
                part of an ongoing conversation, or when the caller asks for a fresh answer.
              </p>
            )}
```

- [ ] **Step 3: Verify**

Run: `bunx nx run-many -t typecheck -p web-ui`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/agents/[id]/page.tsx"
git commit -m "feat(cache): show semantic cache settings on agent detail"
```

---

### Task 10: Scheduled cleanup for both cache tables

Closes the pre-existing gap where `ResponseCacheService.cleanupExpired()` has no caller. For the semantic table this is a performance requirement, not housekeeping: with no vector index, lookup cost scales with live rows per scope.

**Files:**
- Create: `apps/workers/src/jobs/cache-cleanup/handler.ts`
- Create: `apps/workers/src/jobs/cache-cleanup/register.ts`
- Modify: `apps/workers/src/index.ts` (import at lines 4-20, call at lines 37-41)

**Interfaces:**
- Consumes: `ResponseCacheService`, `SemanticCacheService` from `@chatbot/shared`.
- Produces: pg-boss cron job `cache-cleanup`.

- [ ] **Step 1: Write the handler**

```ts
// apps/workers/src/jobs/cache-cleanup/handler.ts
import { getPrismaClient } from '@chatbot/shared/workers';
import { ResponseCacheService, SemanticCacheService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('cache-cleanup');

export async function handleCacheCleanup(): Promise<void> {
  const db = getPrismaClient();

  try {
    const exact = await new ResponseCacheService(db as never).cleanupExpired();
    const semantic = await new SemanticCacheService(db as never).cleanupExpired();
    log.info({ exactRemoved: exact, semanticRemoved: semantic }, 'Expired cache entries swept');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error({ errorMessage: error.message, errorStack: error.stack }, 'Cache cleanup failed');
    throw error;
  }
}
```

- [ ] **Step 2: Write the registration**

```ts
// apps/workers/src/jobs/cache-cleanup/register.ts
import type PgBoss from 'pg-boss';
import { handleCacheCleanup } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('cache-cleanup-register');
const JOB_NAME = 'cache-cleanup';
const CRON_SCHEDULE = '15 * * * *'; // hourly at :15

export async function register(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOB_NAME);

  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Running cache cleanup', { jobId: job.id });
      await handleCacheCleanup();
    }
  });

  try {
    await boss.unschedule(JOB_NAME);
  } catch {
    // no existing schedule
  }

  await boss.schedule(JOB_NAME, CRON_SCHEDULE, {});
  log.info('Registered cron job', { jobName: JOB_NAME, schedule: CRON_SCHEDULE });
}
```

Hourly rather than daily because semantic TTLs may be measured in minutes, and expired rows slow every lookup until removed.

- [ ] **Step 3: Register it**

In `apps/workers/src/index.ts`, add beside the other imports:

```ts
import { register as registerCacheCleanup } from './jobs/cache-cleanup/register.js';
```

and beside the other registration calls:

```ts
  await registerCacheCleanup(boss);
```

- [ ] **Step 4: Verify**

Run:
```bash
bunx nx run-many -t typecheck -p workers
bun run dev:workers
```
Expected: typecheck passes; the worker logs `Registered cron job` with `jobName: cache-cleanup`. Stop the worker afterwards.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/src/jobs/cache-cleanup apps/workers/src/index.ts
git commit -m "feat(workers): hourly cleanup for both cache tables"
```

---

### Task 11: Dockerfile lib linking check

The workers image links each `@chatbot/*` lib explicitly. `SemanticCacheService` is imported from `@chatbot/shared`, which workers already link, so this task is a verification rather than a change — but the check is cheap and the failure mode is a broken image discovered at deploy time.

**Files:**
- Inspect: `apps/workers/Dockerfile`

- [ ] **Step 1: Confirm `@chatbot/shared` is linked with deep-subpath exports**

Run: `grep -n "chatbot/shared" apps/workers/Dockerfile`
Expected: an existing build-and-link block. If `@chatbot/shared/workers` resolves through a `./*` export entry, no change is needed.

- [ ] **Step 2: Build the image**

Run: `docker build -f apps/workers/Dockerfile -t chatbot-workers:cache-test .`
Expected: build succeeds.

- [ ] **Step 3: Commit only if a change was required**

```bash
git add apps/workers/Dockerfile
git commit -m "build(workers): link shared lib for cache cleanup job"
```

---

### Task 12: End-to-end live verification

Mocked tests prove the units; this proves the feature. Run against the local dev server with a throwaway agent, and delete it afterwards.

**Files:** none modified.

- [ ] **Step 1: Create a throwaway agent with semantic caching on**

Create a simple agent on a tenant that has a working embedding provider, with a published version whose config sets `semanticCache: { enabled: true, embeddingModel: '<a real model>', threshold: 0.97 }` and `cacheTtlMinutes: 60`, plus an API key. Record the raw key.

- [ ] **Step 2: Prove an exact hit still works**

Send the same request twice with `stream: false`.
Expected: first `cacheHit: false`; second `cacheHit: true, cacheType: "exact"`.

- [ ] **Step 3: Prove a semantic hit**

Send a **reworded** version of the same question.
Expected: `cacheHit: true, cacheType: "semantic"`, and a `Semantic cache hit` log line showing both prompts and the similarity score.

- [ ] **Step 4: Prove the numeric guard**

Cache "show me revenue for Q3", then ask "show me revenue for Q4".
Expected: `cacheHit: false`. A cached answer here would be a wrong answer.

- [ ] **Step 5: Prove scope isolation**

Create a second agent with the same system prompt and the same question.
Expected: `cacheHit: false` — the first agent's entry must not be visible.

- [ ] **Step 6: Prove fail-open**

Temporarily set the agent's `semanticCache.embeddingModel` to a model that does not exist, bypassing the form so validation is skipped.
Expected: the request still returns `200` with a real answer, and a `Semantic cache unavailable` warning is logged. **A 500 here is a release blocker.**

- [ ] **Step 7: Prove tools disable the tier**

Attach a built-in tool to the agent and repeat step 3.
Expected: `cacheHit: false`, and `cacheEligible: false` in the eligibility debug log.

- [ ] **Step 8: Clean up**

Delete the throwaway agents, their API keys, their `apiKeyExecution` rows, and every `llm_semantic_cache` row created during the run.

- [ ] **Step 9: Record results in the PR description**

List each check with its observed output. Do not claim the feature works without this evidence.

---

## Rollout after merge

Per the spec: ship with the feature off for every agent → enable on one internal agent → read a week of hit and near-miss logs → then decide the default threshold and whether to promote it more widely.

Volatile-query classification remains deferred and **should be owned before semantic caching is enabled by default for any tenant**.
