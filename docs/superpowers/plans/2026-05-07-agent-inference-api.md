# Agent Inference API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public inference API for agent execution with API key auth, quota management, response caching, and session support.

**Architecture:** Add Prisma models for API keys, usage counters, execution logs, inference sessions, and an unlogged cache table. Implement services for key lifecycle, quota enforcement, and cache management. Create a Bearer-token middleware and REST endpoints under `/api/v1/inference/*`. Add dashboard UI for key management and usage analytics.

**Tech Stack:** Next.js App Router, Prisma, PostgreSQL (unlogged tables, pg_cron), TypeScript, Vercel AI SDK, Tailwind/shadcn

---

## File Structure

### Database
- `prisma/schema.prisma` — add `ApiKey`, `ApiKeyUsage`, `ApiKeyExecution`, `InferenceSession`, `LlmResponseCache` models
- `prisma/migrations/` — migration for new tables + unlogged table config

### Services (libs/shared/src/services/)
- `api-key-service.ts` — CRUD, hash, validate, rotate, revoke
- `quota-service.ts` — daily + sliding window enforcement
- `response-cache-service.ts` — unlogged table cache with TTL
- `inference-session-service.ts` — create, get, append, delete sessions

### Middleware + Routes (apps/web-ui/app/api/v1/inference/)
- `middleware.ts` — Bearer token extraction, key validation, tenant injection
- `route.ts` — main inference endpoint (POST)
- `sessions/route.ts` — create session (POST)
- `sessions/[id]/route.ts` — get/delete session (GET/DELETE)
- `usage/route.ts` — usage stats (GET)

### UI (apps/web-ui/)
- `app/(dashboard)/agents/[id]/api-keys/page.tsx` — API key list + create/revoke
- `app/(dashboard)/agents/[id]/usage/page.tsx` — usage charts
- `components/api-keys/api-key-table.tsx`
- `components/api-keys/create-key-dialog.tsx`
- `hooks/use-api-keys.ts`
- `hooks/use-inference-usage.ts`

### Tests
- `libs/shared/src/services/api-key-service.test.ts`
- `libs/shared/src/services/quota-service.test.ts`
- `libs/shared/src/services/response-cache-service.test.ts`
- `tests/e2e/inference-api.spec.ts`

---

## Task 1: Database Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260507_add_inference_api/migration.sql`
- Modify: `prisma/schema.prisma` (add reverse relations to `Agent`)

### Step 1: Add models to Prisma schema

Add after `AgentMcpServer` model:

```prisma
model ApiKey {
  id               String   @id @default(cuid())
  tenantId         String
  agentId          String
  name             String
  keyHash          String   @unique
  keyPrefix        String
  status           String   @default("active")
  scopes           String[] @default(["inference:read"])
  dailyReqLimit    Int      @default(1000)
  dailyTokenLimit  Int      @default(100000)
  expiresAt        DateTime?
  createdBy        String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  tenant       Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agent        Agent             @relation(fields: [agentId], references: [id], onDelete: Cascade)
  executions   ApiKeyExecution[]
  usages       ApiKeyUsage[]
  sessions     InferenceSession[]

  @@index([keyHash])
  @@index([tenantId, agentId, status])
  @@map("api_keys")
}

model ApiKeyUsage {
  id            String   @id @default(cuid())
  apiKeyId      String
  date          DateTime @db.Date
  requestCount  Int      @default(0)
  tokenCount    Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@unique([apiKeyId, date])
  @@index([apiKeyId, date])
  @@map("api_key_usage")
}

model ApiKeyExecution {
  id             String    @id @default(cuid())
  apiKeyId       String
  tenantId       String
  agentId        String
  agentVersionId String?
  status         String    @default("pending")
  input          Json
  output         Json?
  error          String?
  tokenUsage     Json?
  cacheHit       Boolean   @default(false)
  latencyMs      Int?
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime  @default(now())

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@index([apiKeyId, createdAt])
  @@index([tenantId, createdAt])
  @@index([status])
  @@map("api_key_executions")
}

model InferenceSession {
  id        String   @id @default(cuid())
  apiKeyId  String
  tenantId  String
  agentId   String
  name      String?
  messages  Json
  metadata  Json?
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@index([apiKeyId])
  @@index([tenantId, agentId])
  @@index([expiresAt])
  @@map("inference_sessions")
}
```

Add `LlmResponseCache` at the end of the schema file:

```prisma
model LlmResponseCache {
  id          String   @id @default(cuid())
  cacheKey    String   @unique
  response    Json
  metadata    Json?
  hitCount    Int      @default(0)
  expiresAt   DateTime
  createdAt   DateTime @default(now())

  @@index([cacheKey])
  @@index([expiresAt])
  @@map("llm_response_cache")
}
```

Update the existing `Agent` model to add reverse relations:

```prisma
model Agent {
  // ... existing fields ...
  apiKeys           ApiKey[]
  inferenceSessions InferenceSession[]
  // ... rest of relations ...
}
```

### Step 2: Generate migration SQL

Run:
```bash
bunx prisma migrate dev --name add_inference_api
```

Expected: Prisma prompts for migration name, generates SQL.

### Step 3: Create unlogged table for cache

Add to the generated migration file or create a separate migration:

```sql
-- Make LlmResponseCache unlogged for performance
ALTER TABLE llm_response_cache SET UNLOGGED;

-- Create pg_cron extension if not exists (for TTL cleanup)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cache cleanup every 10 minutes
SELECT cron.schedule('llm_cache_cleanup', '*/10 * * * *', 'DELETE FROM llm_response_cache WHERE "expiresAt" < NOW()');
```

### Step 4: Regenerate Prisma client

Run:
```bash
bunx prisma generate
```

Expected: Client generated successfully.

### Step 5: Commit

```bash
git add prisma/
git commit -m "feat(db): add ApiKey, ApiKeyUsage, ApiKeyExecution, InferenceSession, LlmResponseCache models"
```

---

## Task 2: ApiKeyService

**Files:**
- Create: `libs/shared/src/services/api-key-service.ts`
- Create: `libs/shared/src/services/api-key-service.test.ts`

### Step 1: Write failing test

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyService } from './api-key-service';

describe('ApiKeyService', () => {
  const mockDb = {
    apiKey: {
      create: async (args: { data: Record<string, unknown> }) => ({ id: 'key-1', ...args.data }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => ({}),
      delete: async () => ({}),
      count: async () => 0,
    },
  };

  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService('tenant-1', mockDb as unknown as ApiKeyDb);
  });

  it('should create an API key and return the raw key once', async () => {
    const result = await service.create({
      agentId: 'agent-1',
      name: 'Production Key',
      dailyReqLimit: 500,
      dailyTokenLimit: 50000,
      createdBy: 'user-1',
    });

    expect(result.rawKey).toBeDefined();
    expect(result.rawKey).toMatch(/^sk_[a-zA-Z0-9]{48}$/);
    expect(result.apiKey.name).toBe('Production Key');
    expect(result.apiKey.keyHash).not.toBe(result.rawKey); // hash != raw
  });

  it('should validate a key by hash', async () => {
    const { rawKey } = await service.create({
      agentId: 'agent-1',
      name: 'Test Key',
      createdBy: 'user-1',
    });

    const isValid = await service.validateKey(rawKey);
    expect(isValid).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

```bash
bunx vitest run libs/shared/src/services/api-key-service.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement ApiKeyService

```typescript
import crypto from 'crypto';

export interface ApiKeyDb {
  apiKey: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

export interface CreateApiKeyInput {
  agentId: string;
  name: string;
  dailyReqLimit?: number;
  dailyTokenLimit?: number;
  scopes?: string[];
  expiresAt?: Date;
  createdBy: string;
}

export class ApiKeyService {
  constructor(
    private readonly tenantId: string,
    private readonly db: ApiKeyDb
  ) {}

  private generateRawKey(): string {
    const prefix = 'sk_';
    const random = crypto.randomBytes(36).toString('base64url');
    return prefix + random;
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private getKeyPrefix(rawKey: string): string {
    return rawKey.slice(0, 12);
  }

  async create(input: CreateApiKeyInput): Promise<{ rawKey: string; apiKey: unknown }> {
    const rawKey = this.generateRawKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = this.getKeyPrefix(rawKey);

    const apiKey = await this.db.apiKey.create({
      data: {
        tenantId: this.tenantId,
        agentId: input.agentId,
        name: input.name,
        keyHash,
        keyPrefix,
        status: 'active',
        scopes: input.scopes ?? ['inference:read'],
        dailyReqLimit: input.dailyReqLimit ?? 1000,
        dailyTokenLimit: input.dailyTokenLimit ?? 100000,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy,
      },
    });

    return { rawKey, apiKey };
  }

  async validateKey(rawKey: string): Promise<boolean> {
    const keyHash = this.hashKey(rawKey);
    const key = await this.db.apiKey.findFirst({
      where: { keyHash, status: 'active' },
    });

    if (!key) return false;

    // Check expiration
    const record = key as { expiresAt: Date | null };
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return false;
    }

    return true;
  }

  async findByHash(keyHash: string) {
    return this.db.apiKey.findFirst({
      where: { keyHash, tenantId: this.tenantId },
    });
  }

  async findByAgentId(agentId: string) {
    return this.db.apiKey.findMany({
      where: { agentId, tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string) {
    return this.db.apiKey.update({
      where: { id, tenantId: this.tenantId },
      data: { status: 'revoked', updatedAt: new Date() },
    });
  }

  async rotate(id: string, gracePeriodHours = 24): Promise<{ rawKey: string; apiKey: unknown }> {
    const oldKey = await this.db.apiKey.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!oldKey) {
      throw new Error('API key not found');
    }

    // Mark old key as rotating with grace period
    await this.db.apiKey.update({
      where: { id, tenantId: this.tenantId },
      data: {
        status: 'rotating',
        expiresAt: new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
    });

    // Create new key
    const old = oldKey as { agentId: string; name: string; dailyReqLimit: number; dailyTokenLimit: number; scopes: string[]; createdBy: string };
    return this.create({
      agentId: old.agentId,
      name: `${old.name} (rotated)`,
      dailyReqLimit: old.dailyReqLimit,
      dailyTokenLimit: old.dailyTokenLimit,
      scopes: old.scopes,
      createdBy: old.createdBy,
    });
  }

  async delete(id: string) {
    return this.db.apiKey.delete({
      where: { id, tenantId: this.tenantId },
    });
  }
}
```

### Step 4: Run tests to verify they pass

```bash
bunx vitest run libs/shared/src/services/api-key-service.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add libs/shared/src/services/api-key-service.ts libs/shared/src/services/api-key-service.test.ts
git commit -m "feat(shared): add ApiKeyService with create, validate, revoke, rotate"
```

---

## Task 3: QuotaService

**Files:**
- Create: `libs/shared/src/services/quota-service.ts`
- Create: `libs/shared/src/services/quota-service.test.ts`

### Step 1: Write failing test

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaService } from './quota-service';

describe('QuotaService', () => {
  const mockDb = {
    apiKeyUsage: {
      findFirst: async () => null,
      upsert: async () => ({ requestCount: 0, tokenCount: 0 }),
      update: async () => ({}),
    },
  };

  let service: QuotaService;

  beforeEach(() => {
    service = new QuotaService('key-1', mockDb as unknown as QuotaDb);
  });

  it('should allow request when under quota', async () => {
    const result = await service.checkQuota({
      dailyReqLimit: 100,
      dailyTokenLimit: 10000,
      estimatedTokens: 50,
    });

    expect(result.allowed).toBe(true);
  });

  it('should deny request when daily request limit exceeded', async () => {
    mockDb.apiKeyUsage.findFirst = async () => ({
      requestCount: 100,
      tokenCount: 0,
    });

    const result = await service.checkQuota({
      dailyReqLimit: 100,
      dailyTokenLimit: 10000,
      estimatedTokens: 50,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('request limit');
  });
});
```

### Step 2: Run test to verify it fails

```bash
bunx vitest run libs/shared/src/services/quota-service.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement QuotaService

```typescript
export interface QuotaDb {
  apiKeyUsage: {
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface QuotaCheckInput {
  dailyReqLimit: number;
  dailyTokenLimit: number;
  estimatedTokens?: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remainingRequests?: number;
  remainingTokens?: number;
}

export class QuotaService {
  constructor(
    private readonly apiKeyId: string,
    private readonly db: QuotaDb
  ) {}

  private getTodayDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  async checkQuota(input: QuotaCheckInput): Promise<QuotaCheckResult> {
    const today = this.getTodayDate();
    const usage = await this.db.apiKeyUsage.findFirst({
      where: { apiKeyId: this.apiKeyId, date: today },
    }) as { requestCount: number; tokenCount: number } | null;

    const requestCount = usage?.requestCount ?? 0;
    const tokenCount = usage?.tokenCount ?? 0;
    const estimatedTokens = input.estimatedTokens ?? 0;

    if (requestCount >= input.dailyReqLimit) {
      return {
        allowed: false,
        reason: `Daily request limit of ${input.dailyReqLimit} exceeded.`,
        remainingRequests: 0,
        remainingTokens: input.dailyTokenLimit - tokenCount,
      };
    }

    if (tokenCount + estimatedTokens > input.dailyTokenLimit) {
      return {
        allowed: false,
        reason: `Daily token limit of ${input.dailyTokenLimit} exceeded.`,
        remainingRequests: input.dailyReqLimit - requestCount,
        remainingTokens: 0,
      };
    }

    return {
      allowed: true,
      remainingRequests: input.dailyReqLimit - requestCount,
      remainingTokens: input.dailyTokenLimit - tokenCount,
    };
  }

  async incrementUsage(tokens: number): Promise<void> {
    const today = this.getTodayDate();
    await this.db.apiKeyUsage.upsert({
      where: { apiKeyId_date: { apiKeyId: this.apiKeyId, date: today } },
      create: {
        apiKeyId: this.apiKeyId,
        date: today,
        requestCount: 1,
        tokenCount: tokens,
      },
      update: {
        requestCount: { increment: 1 },
        tokenCount: { increment: tokens },
      },
    });
  }

  async getUsage(): Promise<{ requestCount: number; tokenCount: number }> {
    const today = this.getTodayDate();
    const usage = await this.db.apiKeyUsage.findFirst({
      where: { apiKeyId: this.apiKeyId, date: today },
    }) as { requestCount: number; tokenCount: number } | null;

    return {
      requestCount: usage?.requestCount ?? 0,
      tokenCount: usage?.tokenCount ?? 0,
    };
  }
}
```

### Step 4: Run tests to verify they pass

```bash
bunx vitest run libs/shared/src/services/quota-service.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add libs/shared/src/services/quota-service.ts libs/shared/src/services/quota-service.test.ts
git commit -m "feat(shared): add QuotaService with daily quota checks"
```

---

## Task 4: ResponseCacheService

**Files:**
- Create: `libs/shared/src/services/response-cache-service.ts`
- Create: `libs/shared/src/services/response-cache-service.test.ts`

### Step 1: Write failing test

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCacheService } from './response-cache-service';

describe('ResponseCacheService', () => {
  const mockDb = {
    llmResponseCache: {
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      deleteMany: async () => ({}),
    },
  };

  let service: ResponseCacheService;

  beforeEach(() => {
    service = new ResponseCacheService(mockDb as unknown as CacheDb);
  });

  it('should generate consistent cache keys', () => {
    const key1 = service.generateCacheKey({
      agentVersionId: 'v1',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'claude',
      temperature: 0.7,
    });

    const key2 = service.generateCacheKey({
      agentVersionId: 'v1',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'claude',
      temperature: 0.7,
    });

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('should return null for cache miss', async () => {
    const result = await service.get('nonexistent-key');
    expect(result).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

```bash
bunx vitest run libs/shared/src/services/response-cache-service.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement ResponseCacheService

```typescript
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

    // Increment hit count
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
```

### Step 4: Run tests to verify they pass

```bash
bunx vitest run libs/shared/src/services/response-cache-service.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add libs/shared/src/services/response-cache-service.ts libs/shared/src/services/response-cache-service.test.ts
git commit -m "feat(shared): add ResponseCacheService with unlogged table support"
```

---

## Task 5: InferenceSessionService

**Files:**
- Create: `libs/shared/src/services/inference-session-service.ts`
- Create: `libs/shared/src/services/inference-session-service.test.ts`

### Step 1: Write failing test

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InferenceSessionService } from './inference-session-service';

describe('InferenceSessionService', () => {
  const mockDb = {
    inferenceSession: {
      create: async (args: { data: Record<string, unknown> }) => ({ id: 'session-1', ...args.data }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => ({}),
      delete: async () => ({}),
    },
  };

  let service: InferenceSessionService;

  beforeEach(() => {
    service = new InferenceSessionService(mockDb as unknown as SessionDb);
  });

  it('should create a session with default TTL', async () => {
    const session = await service.create({
      apiKeyId: 'key-1',
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      name: 'Test Session',
    });

    expect(session).toBeDefined();
    expect(session.name).toBe('Test Session');
  });
});
```

### Step 2: Run test to verify it fails

```bash
bunx vitest run libs/shared/src/services/inference-session-service.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement InferenceSessionService

```typescript
export interface SessionDb {
  inferenceSession: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CreateSessionInput {
  apiKeyId: string;
  tenantId: string;
  agentId: string;
  name?: string;
  metadata?: Record<string, unknown>;
  ttlHours?: number;
}

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
}

const DEFAULT_SESSION_TTL_HOURS = 24;

export class InferenceSessionService {
  constructor(private readonly db: SessionDb) {}

  async create(input: CreateSessionInput): Promise<unknown> {
    const ttlHours = input.ttlHours ?? DEFAULT_SESSION_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    return this.db.inferenceSession.create({
      data: {
        apiKeyId: input.apiKeyId,
        tenantId: input.tenantId,
        agentId: input.agentId,
        name: input.name ?? null,
        messages: [] as SessionMessage[],
        metadata: input.metadata ?? null,
        expiresAt,
      },
    });
  }

  async findById(id: string) {
    return this.db.inferenceSession.findFirst({
      where: { id, expiresAt: { gt: new Date() } },
    });
  }

  async findByApiKeyId(apiKeyId: string) {
    return this.db.inferenceSession.findMany({
      where: { apiKeyId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async appendMessage(id: string, message: SessionMessage): Promise<unknown> {
    const session = await this.findById(id) as { messages: SessionMessage[] } | null;
    if (!session) {
      throw new Error('Session not found or expired');
    }

    const messages = [...session.messages, message];
    return this.db.inferenceSession.update({
      where: { id },
      data: { messages: messages as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  }

  async delete(id: string): Promise<unknown> {
    return this.db.inferenceSession.delete({
      where: { id },
    });
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.db.inferenceSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }) as { count: number };

    return result.count;
  }
}
```

### Step 4: Run tests to verify they pass

```bash
bunx vitest run libs/shared/src/services/inference-session-service.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add libs/shared/src/services/inference-session-service.ts libs/shared/src/services/inference-session-service.test.ts
git commit -m "feat(shared): add InferenceSessionService with TTL support"
```

---

## Task 6: API Key Auth Middleware

**Files:**
- Create: `apps/web-ui/app/api/v1/inference/middleware.ts`
- Modify: `apps/web-ui/middleware.ts` (update matcher to exclude `/api/v1/inference`)

### Step 1: Implement middleware

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';
import crypto from 'crypto';

export async function inferenceApiMiddleware(req: NextRequest) {
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { type: 'invalid_api_key', message: 'Missing or invalid Authorization header' } },
      { status: 401 }
    );
  }

  const rawKey = authHeader.slice(7);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const db = getPrismaClient();
  const apiKey = await db.apiKey.findFirst({
    where: { keyHash },
    include: { agent: true },
  }) as {
    id: string;
    tenantId: string;
    agentId: string;
    status: string;
    expiresAt: Date | null;
    scopes: string[];
  } | null;

  if (!apiKey) {
    return NextResponse.json(
      { error: { type: 'invalid_api_key', message: 'API key not found' } },
      { status: 401 }
    );
  }

  if (apiKey.status === 'revoked') {
    return NextResponse.json(
      { error: { type: 'invalid_api_key', message: 'API key has been revoked' } },
      { status: 401 }
    );
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    return NextResponse.json(
      { error: { type: 'invalid_api_key', message: 'API key has expired' } },
      { status: 401 }
    );
  }

  // Inject tenant and API key info into request headers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-tenant-id', apiKey.tenantId);
  requestHeaders.set('x-api-key-id', apiKey.id);
  requestHeaders.set('x-agent-id', apiKey.agentId);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}
```

### Step 2: Update Next.js middleware matcher

In `apps/web-ui/middleware.ts`, update the matcher to exclude `/api/v1/inference` from NextAuth:

```typescript
export const config = {
  matcher: [
    '/((?!api/auth|api/health|api/v1/inference|_next/static|_next/image|favicon.ico|login|register|forgot-password|reset-password|signup|docs).*)',
  ],
};
```

### Step 3: Commit

```bash
git add apps/web-ui/app/api/v1/inference/middleware.ts apps/web-ui/middleware.ts
git commit -m "feat(api): add Bearer token middleware for inference API"
```

---

## Task 7: Inference API Routes

**Files:**
- Create: `apps/web-ui/app/api/v1/inference/route.ts`
- Create: `apps/web-ui/app/api/v1/inference/sessions/route.ts`
- Create: `apps/web-ui/app/api/v1/inference/sessions/[id]/route.ts`
- Create: `apps/web-ui/app/api/v1/inference/usage/route.ts`

### Step 1: Implement main inference endpoint

```typescript
import { NextRequest } from 'next/server';
import {
  getPrismaClient,
  createLogger,
  ApiKeyService,
  QuotaService,
  ResponseCacheService,
  InferenceSessionService,
} from '@chatbot/shared';
import { streamChat, createLLMProvider } from '@chatbot/ai';

const logger = createLogger('api:inference');

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  const apiKeyId = req.headers.get('x-api-key-id');
  const agentId = req.headers.get('x-agent-id');

  if (!tenantId || !apiKeyId || !agentId) {
    return new Response(JSON.stringify({ error: { type: 'invalid_api_key', message: 'Unauthorized' } }), { status: 401 });
  }

  const db = getPrismaClient();
  const apiKeyService = new ApiKeyService(tenantId, db);
  const quotaService = new QuotaService(apiKeyId, db);
  const cacheService = new ResponseCacheService(db);
  const sessionService = new InferenceSessionService(db);

  // Get API key details for quota limits
  const apiKey = await apiKeyService.findByHash(
    req.headers.get('authorization')?.slice(7) ?? ''
  ) as { dailyReqLimit: number; dailyTokenLimit: number } | null;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: { type: 'invalid_api_key', message: 'API key not found' } }), { status: 401 });
  }

  // Check quota
  const quotaCheck = await quotaService.checkQuota({
    dailyReqLimit: apiKey.dailyReqLimit,
    dailyTokenLimit: apiKey.dailyTokenLimit,
  });

  if (!quotaCheck.allowed) {
    return new Response(JSON.stringify({ error: { type: 'quota_exceeded', message: quotaCheck.reason } }), { status: 429 });
  }

  const body = await req.json();
  const { messages, sessionId, systemPrompt, temperature, maxTokens, stream, noCache } = body;

  // Fetch agent and published version
  const agent = await db.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent || agent.status !== 'active') {
    return new Response(JSON.stringify({ error: { type: 'agent_not_found', message: 'Agent not found or inactive' } }), { status: 404 });
  }

  const version = await db.agentVersion.findFirst({
    where: { agentId, status: 'published' },
    orderBy: { version: 'desc' },
  });

  if (!version) {
    return new Response(JSON.stringify({ error: { type: 'agent_not_found', message: 'No published version found for this agent' } }), { status: 404 });
  }

  const config = (version.config as Record<string, unknown>) ?? {};
  const simpleConfig = config as { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number };

  const effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
  const effectiveModel = simpleConfig.model ?? undefined;
  const effectiveTemperature = temperature ?? simpleConfig.temperature ?? 0.7;
  const effectiveMaxTokens = maxTokens ?? simpleConfig.maxTokens ?? 4096;

  // Session handling
  let sessionMessages = messages ?? [];
  if (sessionId) {
    const session = await sessionService.findById(sessionId) as { messages: Array<{ role: string; content: string }> } | null;
    if (session) {
      sessionMessages = [...session.messages, ...messages];
    }
  }

  const coreMessages = sessionMessages.map((m: { role: string; content?: string }) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content ?? '',
  }));

  // Cache check
  const cacheKey = cacheService.generateCacheKey({
    agentVersionId: version.id,
    systemPrompt: effectiveSystem,
    messages: coreMessages,
    model: effectiveModel ?? 'default',
    temperature: effectiveTemperature,
  });

  if (!noCache) {
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      await quotaService.incrementUsage(cached.usage.totalTokens);
      await db.apiKeyExecution.create({
        data: {
          apiKeyId,
          tenantId,
          agentId,
          agentVersionId: version.id,
          status: 'completed',
          input: { messages: sessionMessages },
          output: { text: cached.text },
          tokenUsage: cached.usage,
          cacheHit: true,
        },
      });

      return new Response(JSON.stringify({
        id: 'cached',
        content: cached.text,
        usage: cached.usage,
        cacheHit: true,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Execute LLM
  const startedAt = new Date();
  const execution = await db.apiKeyExecution.create({
    data: {
      apiKeyId,
      tenantId,
      agentId,
      agentVersionId: version.id,
      status: 'running',
      input: { messages: sessionMessages },
      startedAt,
    },
  });

  const result = streamChat({
    provider: createLLMProvider({ /* tenant config */ }),
    messages: coreMessages,
    model: effectiveModel,
    system: effectiveSystem,
    temperature: effectiveTemperature,
    maxOutputTokens: effectiveMaxTokens,
    onFinish: async ({ text, usage }) => {
      const completedAt = new Date();
      const latencyMs = completedAt.getTime() - startedAt.getTime();
      const tokenUsage = { inputTokens: usage?.promptTokens ?? 0, outputTokens: usage?.completionTokens ?? 0, totalTokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0) };

      await quotaService.incrementUsage(tokenUsage.totalTokens);

      if (!noCache) {
        await cacheService.set(cacheKey, { text, usage: tokenUsage });
      }

      // Update session if provided
      if (sessionId) {
        await sessionService.appendMessage(sessionId, {
          role: 'assistant',
          content: text,
          timestamp: completedAt.toISOString(),
        });
      }

      await db.apiKeyExecution.update({
        where: { id: (execution as { id: string }).id },
        data: {
          status: 'completed',
          output: { text },
          tokenUsage: tokenUsage as unknown as Record<string, unknown>,
          cacheHit: false,
          latencyMs,
          completedAt,
        },
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
```

### Step 2: Implement session routes

`apps/web-ui/app/api/v1/inference/sessions/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getPrismaClient, InferenceSessionService } from '@chatbot/shared';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  const apiKeyId = req.headers.get('x-api-key-id');
  const agentId = req.headers.get('x-agent-id');

  if (!tenantId || !apiKeyId || !agentId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await req.json();
  const { name, ttlHours } = body;

  const db = getPrismaClient();
  const service = new InferenceSessionService(db);
  const session = await service.create({
    apiKeyId,
    tenantId,
    agentId,
    name,
    ttlHours,
  });

  return new Response(JSON.stringify(session), { status: 201 });
}

export async function GET(req: NextRequest) {
  const apiKeyId = req.headers.get('x-api-key-id');
  if (!apiKeyId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const db = getPrismaClient();
  const service = new InferenceSessionService(db);
  const sessions = await service.findByApiKeyId(apiKeyId);

  return new Response(JSON.stringify(sessions), { status: 200 });
}
```

`apps/web-ui/app/api/v1/inference/sessions/[id]/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getPrismaClient, InferenceSessionService } from '@chatbot/shared';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getPrismaClient();
  const service = new InferenceSessionService(db);
  const session = await service.findById(id);

  if (!session) {
    return new Response(JSON.stringify({ error: { type: 'session_expired', message: 'Session not found or expired' } }), { status: 410 });
  }

  return new Response(JSON.stringify(session), { status: 200 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getPrismaClient();
  const service = new InferenceSessionService(db);
  await service.delete(id);

  return new Response(null, { status: 204 });
}
```

### Step 3: Implement usage endpoint

`apps/web-ui/app/api/v1/inference/usage/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getPrismaClient, QuotaService } from '@chatbot/shared';

export async function GET(req: NextRequest) {
  const apiKeyId = req.headers.get('x-api-key-id');
  if (!apiKeyId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const db = getPrismaClient();
  const quotaService = new QuotaService(apiKeyId, db);
  const usage = await quotaService.getUsage();

  return new Response(JSON.stringify({
    date: new Date().toISOString().split('T')[0],
    requestCount: usage.requestCount,
    tokenCount: usage.tokenCount,
  }), { status: 200 });
}
```

### Step 4: Commit

```bash
git add apps/web-ui/app/api/v1/inference/
git commit -m "feat(api): add inference endpoints with quota, cache, and session support"
```

---

## Task 8: Internal API Key Management Routes

**Files:**
- Create: `apps/web-ui/app/api/agents/[id]/api-keys/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/api-keys/[keyId]/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/api-keys/[keyId]/revoke/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/api-keys/[keyId]/rotate/route.ts`

### Step 1: Implement list/create API keys

```typescript
import { NextRequest } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, ApiKeyService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const userId = await getSessionUserId(authOptions);
  const authError = await authorize('read', 'Agent', authOptions);
  if (authError) return authError;

  const { id } = await params;
  const db = getPrismaClient();
  const service = new ApiKeyService(tenantId, db);
  const keys = await service.findByAgentId(id);

  return new Response(JSON.stringify(keys), { status: 200 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const userId = await getSessionUserId(authOptions);
  const authError = await authorize('create', 'Agent', authOptions);
  if (authError) return authError;

  const { id } = await params;
  const body = await req.json();
  const { name, dailyReqLimit, dailyTokenLimit, scopes, expiresAt } = body;

  const db = getPrismaClient();
  const service = new ApiKeyService(tenantId, db);
  const result = await service.create({
    agentId: id,
    name,
    dailyReqLimit,
    dailyTokenLimit,
    scopes,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    createdBy: userId,
  });

  return new Response(JSON.stringify(result), { status: 201 });
}
```

### Step 2: Implement revoke and rotate

`apps/web-ui/app/api/agents/[id]/api-keys/[keyId]/revoke/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ApiKeyService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const authError = await authorize('update', 'Agent', authOptions);
  if (authError) return authError;

  const { keyId } = await params;
  const db = getPrismaClient();
  const service = new ApiKeyService(tenantId, db);
  await service.revoke(keyId);

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
```

`apps/web-ui/app/api/agents/[id]/api-keys/[keyId]/rotate/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ApiKeyService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const tenantId = await getSessionTenantId(authOptions);
  const authError = await authorize('update', 'Agent', authOptions);
  if (authError) return authError;

  const { keyId } = await params;
  const body = await req.json();
  const { gracePeriodHours } = body;

  const db = getPrismaClient();
  const service = new ApiKeyService(tenantId, db);
  const result = await service.rotate(keyId, gracePeriodHours);

  return new Response(JSON.stringify(result), { status: 200 });
}
```

### Step 3: Commit

```bash
git add apps/web-ui/app/api/agents/[id]/api-keys/
git commit -m "feat(api): add internal API key management endpoints"
```

---

## Task 9: UI — API Key Management Page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/agents/[id]/api-keys/page.tsx`
- Create: `apps/web-ui/components/api-keys/api-key-table.tsx`
- Create: `apps/web-ui/components/api-keys/create-key-dialog.tsx`
- Create: `apps/web-ui/hooks/use-api-keys.ts`

### Step 1: Implement hook

`apps/web-ui/hooks/use-api-keys.ts`:

```typescript
import { useState, useCallback } from 'react';

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  scopes: string[];
  dailyReqLimit: number;
  dailyTokenLimit: number;
  expiresAt: string | null;
  createdAt: string;
}

export function useApiKeys(agentId: string) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/agents/${agentId}/api-keys`);
    const data = await res.json();
    setKeys(data);
    setLoading(false);
  }, [agentId]);

  const createKey = useCallback(async (input: { name: string; dailyReqLimit?: number; dailyTokenLimit?: number }) => {
    const res = await fetch(`/api/agents/${agentId}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.json();
  }, [agentId]);

  const revokeKey = useCallback(async (keyId: string) => {
    await fetch(`/api/agents/${agentId}/api-keys/${keyId}/revoke`, { method: 'POST' });
    await fetchKeys();
  }, [agentId, fetchKeys]);

  return { keys, loading, fetchKeys, createKey, revokeKey };
}
```

### Step 2: Implement page and components

`apps/web-ui/app/(dashboard)/agents/[id]/api-keys/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useApiKeys } from '@/hooks/use-api-keys';
import { ApiKeyTable } from '@/components/api-keys/api-key-table';
import { CreateKeyDialog } from '@/components/api-keys/create-key-dialog';

export default function ApiKeysPage() {
  const params = useParams();
  const agentId = params.id as string;
  const { keys, loading, fetchKeys, createKey, revokeKey } = useApiKeys(agentId);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <CreateKeyDialog agentId={agentId} onCreate={createKey} onSuccess={fetchKeys} />
      </div>
      <ApiKeyTable keys={keys} loading={loading} onRevoke={revokeKey} />
    </div>
  );
}
```

Create `ApiKeyTable` and `CreateKeyDialog` components (standard shadcn table + dialog pattern).

### Step 3: Commit

```bash
git add apps/web-ui/app/(dashboard)/agents/[id]/api-keys/ apps/web-ui/components/api-keys/ apps/web-ui/hooks/use-api-keys.ts
git commit -m "feat(ui): add API key management page with create/revoke"
```

---

## Task 10: E2E Tests

**Files:**
- Create: `tests/e2e/inference-api.spec.ts`

### Step 1: Write E2E test

```typescript
import { test, expect } from '@playwright/test';

test.describe('Inference API', () => {
  test('should reject request without API key', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      data: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.type).toBe('invalid_api_key');
  });

  test('should reject request with invalid API key', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      headers: { Authorization: 'Bearer invalid_key_12345' },
      data: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(response.status()).toBe(401);
  });
});
```

### Step 2: Run E2E tests

```bash
bun run e2e
```

Expected: Tests execute (may fail if full setup not complete, but framework runs).

### Step 3: Commit

```bash
git add tests/e2e/inference-api.spec.ts
git commit -m "test(e2e): add inference API auth tests"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| API key model + lifecycle | Task 1, Task 2 |
| Quota enforcement (daily) | Task 3, Task 7 |
| Sliding window rate limit | Task 3 (commented — add `minuteCount` field) |
| Response caching (unlogged table) | Task 1 (migration), Task 4 |
| Inference sessions | Task 1, Task 5, Task 7 |
| Bearer token middleware | Task 6 |
| Public inference endpoint | Task 7 |
| Usage tracking (`ApiKeyExecution`) | Task 7 |
| Internal key management API | Task 8 |
| UI for key management | Task 9 |
| Error handling | Task 6, Task 7 |
| E2E tests | Task 10 |

**Gap identified:** Sliding window rate limit (per-minute burst protection) is mentioned in the spec but only partially implemented. After Task 3, add a `minuteCount` and `minuteUpdatedAt` fields to `ApiKeyUsage`, or use a separate in-memory store for sub-minute windows (requires Redis or in-memory rate limiter).

**Recommendation:** Implement sliding window as a follow-up task after the core system is working. Postgres-level minute counters have race conditions under high load; a proper solution requires Redis or an in-memory distributed rate limiter.

---

## Post-Implementation Checklist

- [ ] Run `bunx prisma migrate dev` and verify all tables created
- [ ] Verify `LlmResponseCache` is unlogged: `\d llm_response_cache` in psql
- [ ] Verify `pg_cron` job scheduled: `SELECT * FROM cron.job;`
- [ ] Run all unit tests: `bun run test`
- [ ] Run E2E tests: `bun run e2e`
- [ ] Test end-to-end flow: create key → call inference → check usage → revoke key
- [ ] Verify cache hit: call same prompt twice, second should be near-instant
- [ ] Verify quota enforcement: exceed daily limit, expect 429
