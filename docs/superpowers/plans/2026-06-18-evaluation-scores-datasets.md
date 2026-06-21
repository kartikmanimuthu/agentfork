# Evaluation Module (Scores + Datasets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-scoped Evaluation module with config-driven typed Scores on chat traces and curated Datasets, modeled on Langfuse.

**Architecture:** Four new Prisma models (`ScoreConfig`, `Score`, `Dataset`, `DatasetItem`) cascade-scoped to `Tenant`. Four class-based services in `libs/shared` (Prisma injected, Pino logging) back both NextAuth-session dashboard API routes and one API-key ingestion endpoint. A new `Evaluation` RBAC module gates dashboard access; a `scores:write` API-key scope gates ingestion. The dashboard gains an "Evaluation" sidebar group (Scores + Datasets pages) plus an inline scoring drawer on the existing inference detail page.

**Tech Stack:** Bun, Nx, Next.js 15 (App Router), TypeScript strict, Prisma + PostgreSQL, Zod, NextAuth v4, React Query, shadcn/ui, Pino, Vitest.

## Global Constraints

- TypeScript strict mode; no implicit `any`, all function params typed.
- All API route handlers and frontend forms validate input with Zod (`libs/shared/src/validation`).
- Never access `process.env` directly — use the typed env objects.
- All UI uses shadcn/ui components exclusively (`apps/web-ui/components/ui`).
- Every function/route/service method wrapped in try/catch; caught errors logged via Pino (never swallowed) with structured context, then re-thrown or returned as typed error responses.
- Use the shared Pino logger via `createLogger('<name>')` from `libs/shared/src/logging/logger`. No `console.*` in services.
- Prisma models use `@@map()` snake_case tables, camelCase fields.
- Services follow the class-based, constructor-injected-`db` pattern (see `libs/shared/src/services/feedback-service.ts`).
- Regenerate the Prisma client after schema changes (`bunx prisma generate`).
- Spec of record: `docs/superpowers/specs/2026-06-18-evaluation-scores-datasets-design.md`.

## File Structure

**Created:**
- `libs/shared/src/validation/schemas/evaluation.ts` — all Zod schemas + inferred types.
- `libs/shared/src/services/score-config-service.ts` (+ `.test.ts`)
- `libs/shared/src/services/score-service.ts` (+ `.test.ts`)
- `libs/shared/src/services/dataset-service.ts` (+ `.test.ts`)
- `libs/shared/src/services/dataset-item-service.ts` (+ `.test.ts`)
- `apps/web-ui/app/api/evaluation/score-configs/route.ts` + `[id]/route.ts`
- `apps/web-ui/app/api/evaluation/scores/route.ts` + `[id]/route.ts`
- `apps/web-ui/app/api/evaluation/datasets/route.ts` + `[id]/route.ts`
- `apps/web-ui/app/api/evaluation/datasets/[id]/items/route.ts` + `[itemId]/route.ts` + `from-trace/route.ts`
- `apps/web-ui/app/api/v1/scores/route.ts` + `apps/web-ui/app/api/v1/scores/lib/auth.ts`
- `apps/web-ui/app/(dashboard)/evaluation/scores/page.tsx`
- `apps/web-ui/app/(dashboard)/evaluation/datasets/page.tsx`
- `apps/web-ui/app/(dashboard)/evaluation/datasets/[id]/page.tsx`
- `apps/web-ui/components/evaluation/score-drawer.tsx`

**Modified:**
- `prisma/schema.prisma` — 4 models + back-relations on `Tenant`, `InferenceSession`, `InferenceSessionMessage`.
- `libs/shared/src/rbac/types.ts` — add `Evaluation` to `Module` + `SUBJECT_TO_MODULE`.
- `libs/shared/src/rbac/permissions.ts` — grant `Evaluation` per role + bump `getAutoLevel` max.
- `libs/shared/src/validation/schemas/role.ts` — add `Evaluation` to `permissionSetSchema`.
- `libs/shared/src/validation/schemas/index.ts` — export `evaluation`.
- `libs/shared/src/index.ts` — export the four services + their input types.
- `apps/web-ui/components/layout/app-sidebar.tsx` — add Evaluation nav group.
- `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx` — mount the score drawer.

---

### Task 1: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: tables `score_configs`, `scores`, `datasets`, `dataset_items`; Prisma delegates `prisma.scoreConfig`, `prisma.score`, `prisma.dataset`, `prisma.datasetItem`.

- [ ] **Step 1: Add the four models to `prisma/schema.prisma`** (append after the `AgentWorkflow` model)

```prisma
model ScoreConfig {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  dataType    String   // NUMERIC | CATEGORICAL | BOOLEAN
  minValue    Float?
  maxValue    Float?
  categories  Json?    // [{ label: string, value: number }] for CATEGORICAL
  isArchived  Boolean  @default(false)
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  scores Score[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@index([tenantId, isArchived])
  @@map("score_configs")
}

model Score {
  id           String   @id @default(cuid())
  tenantId     String
  configId     String
  targetType   String   // MESSAGE | SESSION
  messageId    String?
  sessionId    String?
  numericValue Float?
  stringValue  String?
  comment      String?
  source       String   @default("ANNOTATION") // ANNOTATION | API
  authorUserId String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenant  Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  config  ScoreConfig  @relation(fields: [configId], references: [id], onDelete: Restrict)
  message InferenceSessionMessage? @relation(fields: [messageId], references: [id], onDelete: SetNull)
  session InferenceSession?        @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@index([tenantId])
  @@index([messageId])
  @@index([sessionId])
  @@index([configId])
  @@index([tenantId, source])
  @@map("scores")
}

model Dataset {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  metadata    Json?
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  items  DatasetItem[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("datasets")
}

model DatasetItem {
  id              String   @id @default(cuid())
  datasetId       String
  input           Json
  expectedOutput  Json?
  metadata        Json?
  status          String   @default("ACTIVE") // ACTIVE | ARCHIVED
  sourceMessageId String?  // provenance only, no FK
  sourceSessionId String?  // provenance only, no FK
  createdBy       String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  dataset Dataset @relation(fields: [datasetId], references: [id], onDelete: Cascade)

  @@index([datasetId])
  @@index([datasetId, status])
  @@map("dataset_items")
}
```

> Note (deviation from spec §3): `DatasetItem.sourceMessageId/sourceSessionId` are plain provenance columns, not FKs, to avoid adding extra back-relations to trace models. The "SetNull on trace delete" intent is satisfied since there is no constraint.

- [ ] **Step 2: Add back-relations to existing models.** In `model Tenant` add to its relation block:

```prisma
  scoreConfigs      ScoreConfig[]
  scores            Score[]
  datasets          Dataset[]
```

In `model InferenceSession` (after `csatResponse CsatResponse?`) add:

```prisma
  scores       Score[]
```

In `model InferenceSessionMessage` (after `feedback MessageFeedback?`) add:

```prisma
  scores  Score[]
```

- [ ] **Step 3: Generate client + create migration**

Run: `bunx prisma generate --schema=./prisma/schema.prisma && bunx prisma migrate dev --name evaluation_scores_datasets`
Expected: migration created under `prisma/migrations/`, client regenerated, no errors. If the local DB is unavailable, fall back to `bunx prisma db push` and note the migration must be generated in CI.

- [ ] **Step 4: Verify the schema compiles**

Run: `bunx prisma validate --schema=./prisma/schema.prisma`
Expected: "The schema at ./prisma/schema.prisma is valid 🚀"

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(evaluation): add scores + datasets prisma models"
```

---

### Task 2: RBAC module + API-key scope

**Files:**
- Modify: `libs/shared/src/rbac/types.ts`
- Modify: `libs/shared/src/rbac/permissions.ts`
- Modify: `libs/shared/src/validation/schemas/role.ts`
- Test: `libs/shared/src/rbac/permissions.test.ts`

**Interfaces:**
- Produces: `Module` union includes `'Evaluation'`; `SUBJECT_TO_MODULE` maps `Score`, `ScoreConfig`, `Dataset`, `DatasetItem` → `'Evaluation'`; `hasPermission(role, action, 'Evaluation')` works.

- [ ] **Step 1: Write the failing test** — append to `libs/shared/src/rbac/permissions.test.ts`

```typescript
import { ROLE_PERMISSIONS } from './permissions';

describe('Evaluation module permissions', () => {
  it('grants Owner full Evaluation CRUD', () => {
    expect(ROLE_PERMISSIONS.Owner.Evaluation).toEqual(['create', 'read', 'update', 'delete']);
  });
  it('grants Viewer read-only Evaluation', () => {
    expect(ROLE_PERMISSIONS.Viewer.Evaluation).toEqual(['read']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nx test shared -- permissions`
Expected: FAIL — `Evaluation` undefined on `ROLE_PERMISSIONS.Owner`.

- [ ] **Step 3: Add `Evaluation` to the `Module` union and subject map** in `libs/shared/src/rbac/types.ts`

```typescript
export type Module = 'Settings' | 'Users' | 'Tenants' | 'Agents' | 'KnowledgeBases' | 'McpServers' | 'LlmProviders' | 'Evaluation';
```

and add to `SUBJECT_TO_MODULE`:

```typescript
  Score: 'Evaluation',
  ScoreConfig: 'Evaluation',
  Dataset: 'Evaluation',
  DatasetItem: 'Evaluation',
```

- [ ] **Step 4: Grant the module per role** in `libs/shared/src/rbac/permissions.ts` — add to each role object in `ROLE_PERMISSIONS`:

```typescript
// Owner:
    Evaluation: ['create', 'read', 'update', 'delete'],
// Admin:
    Evaluation: ['create', 'read', 'update', 'delete'],
// Member:
    Evaluation: ['create', 'read', 'update'],
// Viewer:
    Evaluation: ['read'],
```

Then bump `getAutoLevel`'s `maxPossible` from `28` to `32` and its comment to `// 8 modules * 4 actions`.

- [ ] **Step 5: Add `Evaluation` to the role validation schema** in `libs/shared/src/validation/schemas/role.ts`, inside `permissionSetSchema`'s object:

```typescript
  Evaluation: actionArraySchema,
```

- [ ] **Step 6: Run tests to verify pass**

Run: `nx test shared -- permissions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/rbac libs/shared/src/validation/schemas/role.ts
git commit -m "feat(evaluation): add Evaluation RBAC module"
```

---

### Task 3: Zod validation schemas

**Files:**
- Create: `libs/shared/src/validation/schemas/evaluation.ts`
- Modify: `libs/shared/src/validation/schemas/index.ts`
- Test: `libs/shared/src/validation/schemas/evaluation.test.ts`

**Interfaces:**
- Produces: `scoreConfigCreateSchema`, `scoreConfigUpdateSchema`, `scoreManualCreateSchema`, `scoreIngestSchema`, `scoreListQuerySchema`, `datasetCreateSchema`, `datasetUpdateSchema`, `datasetItemCreateSchema`, `datasetItemBulkSchema`, `addFromTraceSchema`, and inferred types `ScoreConfigCreate`, `ScoreManualCreate`, `ScoreIngest`, `DatasetCreate`, `DatasetItemCreate`.

- [ ] **Step 1: Write the failing test** — `libs/shared/src/validation/schemas/evaluation.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  scoreConfigCreateSchema,
  scoreManualCreateSchema,
  datasetItemCreateSchema,
} from './evaluation';

describe('scoreConfigCreateSchema', () => {
  it('accepts a NUMERIC config with bounds', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'helpfulness', dataType: 'NUMERIC', minValue: 1, maxValue: 5 });
    expect(r.success).toBe(true);
  });
  it('rejects NUMERIC where min >= max', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'x', dataType: 'NUMERIC', minValue: 5, maxValue: 1 });
    expect(r.success).toBe(false);
  });
  it('rejects CATEGORICAL with empty categories', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'tone', dataType: 'CATEGORICAL', categories: [] });
    expect(r.success).toBe(false);
  });
  it('accepts CATEGORICAL with categories', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'tone', dataType: 'CATEGORICAL', categories: [{ label: 'good', value: 1 }] });
    expect(r.success).toBe(true);
  });
});

describe('scoreManualCreateSchema', () => {
  it('accepts a message score', () => {
    const r = scoreManualCreateSchema.safeParse({ configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 4 });
    expect(r.success).toBe(true);
  });
  it('rejects missing value', () => {
    const r = scoreManualCreateSchema.safeParse({ configId: 'c1', targetType: 'MESSAGE', targetId: 'm1' });
    expect(r.success).toBe(false);
  });
});

describe('datasetItemCreateSchema', () => {
  it('requires input', () => {
    expect(datasetItemCreateSchema.safeParse({}).success).toBe(false);
    expect(datasetItemCreateSchema.safeParse({ input: { q: 'hi' } }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nx test shared -- evaluation`
Expected: FAIL — cannot resolve `./evaluation`.

- [ ] **Step 3: Implement `libs/shared/src/validation/schemas/evaluation.ts`**

```typescript
import { z } from 'zod';

export const scoreDataTypeSchema = z.enum(['NUMERIC', 'CATEGORICAL', 'BOOLEAN']);
export const scoreTargetTypeSchema = z.enum(['MESSAGE', 'SESSION']);
const scoreCategorySchema = z.object({ label: z.string().min(1), value: z.number() });

const scoreConfigBase = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  dataType: scoreDataTypeSchema,
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  categories: z.array(scoreCategorySchema).optional(),
});

const refineConfig = (s: z.infer<typeof scoreConfigBase>, ctx: z.RefinementCtx) => {
  if (s.dataType === 'NUMERIC' && s.minValue != null && s.maxValue != null && s.minValue >= s.maxValue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minValue must be < maxValue', path: ['minValue'] });
  }
  if (s.dataType === 'CATEGORICAL' && (!s.categories || s.categories.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CATEGORICAL requires at least one category', path: ['categories'] });
  }
};

export const scoreConfigCreateSchema = scoreConfigBase.superRefine(refineConfig);
export const scoreConfigUpdateSchema = scoreConfigBase.partial().extend({
  name: z.string().min(1).max(100).optional(),
  isArchived: z.boolean().optional(),
});

const scoreValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const scoreManualCreateSchema = z.object({
  configId: z.string().min(1),
  targetType: scoreTargetTypeSchema,
  targetId: z.string().min(1),
  value: scoreValueSchema,
  comment: z.string().max(1000).optional(),
});

export const scoreIngestSchema = scoreManualCreateSchema; // same shape; auth differs

export const scoreListQuerySchema = z.object({
  configId: z.string().optional(),
  targetType: scoreTargetTypeSchema.optional(),
  source: z.enum(['ANNOTATION', 'API']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const datasetCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  metadata: z.unknown().optional(),
});
export const datasetUpdateSchema = datasetCreateSchema.partial();

export const datasetItemCreateSchema = z.object({
  input: z.unknown().refine((v) => v !== undefined && v !== null, 'input is required'),
  expectedOutput: z.unknown().optional(),
  metadata: z.unknown().optional(),
});
export const datasetItemBulkSchema = z.object({ items: z.array(datasetItemCreateSchema).min(1).max(1000) });

export const addFromTraceSchema = z.object({
  targetType: scoreTargetTypeSchema,
  targetId: z.string().min(1),
});

export type ScoreConfigCreate = z.infer<typeof scoreConfigCreateSchema>;
export type ScoreManualCreate = z.infer<typeof scoreManualCreateSchema>;
export type ScoreIngest = z.infer<typeof scoreIngestSchema>;
export type DatasetCreate = z.infer<typeof datasetCreateSchema>;
export type DatasetItemCreate = z.infer<typeof datasetItemCreateSchema>;
```

- [ ] **Step 4: Export from the schema barrel** — add to `libs/shared/src/validation/schemas/index.ts`

```typescript
export * from './evaluation';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `nx test shared -- evaluation`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/validation/schemas/evaluation.ts libs/shared/src/validation/schemas/evaluation.test.ts libs/shared/src/validation/schemas/index.ts
git commit -m "feat(evaluation): add zod validation schemas"
```

---

### Task 4: ScoreConfigService

**Files:**
- Create: `libs/shared/src/services/score-config-service.ts`
- Test: `libs/shared/src/services/score-config-service.test.ts`
- Modify: `libs/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `class ScoreConfigService { constructor(db: ScoreConfigDb) }`
  - `create(input: CreateScoreConfigInput): Promise<unknown>`
  - `list(tenantId: string, opts?: { includeArchived?: boolean }): Promise<unknown[]>`
  - `get(tenantId: string, id: string): Promise<unknown | null>`
  - `update(tenantId: string, id: string, patch: UpdateScoreConfigInput): Promise<unknown>`
  - `archive(tenantId: string, id: string): Promise<unknown>`
  - Types `ScoreDataType = 'NUMERIC'|'CATEGORICAL'|'BOOLEAN'`, `ScoreCategory = { label: string; value: number }`, `CreateScoreConfigInput`, `UpdateScoreConfigInput`.

- [ ] **Step 1: Write the failing test** — `libs/shared/src/services/score-config-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoreConfigService } from './score-config-service';

const mockDb = {
  scoreConfig: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

describe('ScoreConfigService', () => {
  let service: ScoreConfigService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScoreConfigService(mockDb as any);
  });

  it('creates a NUMERIC config', async () => {
    mockDb.scoreConfig.create.mockResolvedValue({ id: 'c1' });
    await service.create({ tenantId: 't1', name: 'helpfulness', dataType: 'NUMERIC', minValue: 1, maxValue: 5, createdBy: 'u1' });
    expect(mockDb.scoreConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'helpfulness', dataType: 'NUMERIC', minValue: 1, maxValue: 5, createdBy: 'u1' }),
    });
  });

  it('rejects CATEGORICAL without categories', async () => {
    await expect(
      service.create({ tenantId: 't1', name: 'tone', dataType: 'CATEGORICAL', createdBy: 'u1' }),
    ).rejects.toThrow(/categor/i);
  });

  it('lists non-archived configs by default', async () => {
    mockDb.scoreConfig.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.scoreConfig.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isArchived: false },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('archives a config scoped to tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
    mockDb.scoreConfig.update.mockResolvedValue({ id: 'c1', isArchived: true });
    await service.archive('t1', 'c1');
    expect(mockDb.scoreConfig.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isArchived: true } });
  });

  it('throws when archiving a config from another tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(null);
    await expect(service.archive('t1', 'cX')).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nx test shared -- score-config-service`
Expected: FAIL — cannot resolve `./score-config-service`.

- [ ] **Step 3: Implement `libs/shared/src/services/score-config-service.ts`**

```typescript
import { createLogger } from '../logging/logger';

const logger = createLogger('score-config-service');

export type ScoreDataType = 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
export interface ScoreCategory { label: string; value: number; }

export interface CreateScoreConfigInput {
  tenantId: string;
  name: string;
  description?: string;
  dataType: ScoreDataType;
  minValue?: number;
  maxValue?: number;
  categories?: ScoreCategory[];
  createdBy: string;
}

export interface UpdateScoreConfigInput {
  name?: string;
  description?: string;
  minValue?: number;
  maxValue?: number;
  categories?: ScoreCategory[];
  isArchived?: boolean;
}

export interface ScoreConfigDb {
  scoreConfig: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

function assertValidConfig(input: { dataType: ScoreDataType; minValue?: number; maxValue?: number; categories?: ScoreCategory[] }): void {
  if (input.dataType === 'NUMERIC' && input.minValue != null && input.maxValue != null && input.minValue >= input.maxValue) {
    throw new Error('minValue must be less than maxValue');
  }
  if (input.dataType === 'CATEGORICAL' && (!input.categories || input.categories.length === 0)) {
    throw new Error('CATEGORICAL config requires at least one category');
  }
}

export class ScoreConfigService {
  constructor(private readonly db: ScoreConfigDb) {}

  async create(input: CreateScoreConfigInput): Promise<unknown> {
    try {
      assertValidConfig(input);
      logger.info({ tenantId: input.tenantId, name: input.name, dataType: input.dataType }, 'Creating score config');
      return await this.db.scoreConfig.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          dataType: input.dataType,
          minValue: input.minValue ?? null,
          maxValue: input.maxValue ?? null,
          categories: input.categories ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create score config');
      throw error;
    }
  }

  async list(tenantId: string, opts?: { includeArchived?: boolean }): Promise<unknown[]> {
    try {
      const where: Record<string, unknown> = { tenantId };
      if (!opts?.includeArchived) where.isArchived = false;
      return await this.db.scoreConfig.findMany({ where, orderBy: { createdAt: 'desc' } });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list score configs');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    return this.db.scoreConfig.findFirst({ where: { id, tenantId } });
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const existing = await this.db.scoreConfig.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Score config not found');
  }

  async update(tenantId: string, id: string, patch: UpdateScoreConfigInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      logger.info({ tenantId, id }, 'Updating score config');
      return await this.db.scoreConfig.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update score config');
      throw error;
    }
  }

  async archive(tenantId: string, id: string): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      logger.info({ tenantId, id }, 'Archiving score config');
      return await this.db.scoreConfig.update({ where: { id }, data: { isArchived: true } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to archive score config');
      throw error;
    }
  }
}
```

- [ ] **Step 4: Export from `libs/shared/src/index.ts`** (add after the `CsatService` export)

```typescript
export { ScoreConfigService } from './services/score-config-service';
export type { CreateScoreConfigInput, UpdateScoreConfigInput, ScoreDataType, ScoreCategory } from './services/score-config-service';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `nx test shared -- score-config-service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/score-config-service.ts libs/shared/src/services/score-config-service.test.ts libs/shared/src/index.ts
git commit -m "feat(evaluation): add ScoreConfigService"
```

---

### Task 5: ScoreService

**Files:**
- Create: `libs/shared/src/services/score-service.ts`
- Test: `libs/shared/src/services/score-service.test.ts`
- Modify: `libs/shared/src/index.ts`

**Interfaces:**
- Consumes: `ScoreDataType`, `ScoreCategory` from `score-config-service`.
- Produces:
  - `class ScoreService { constructor(db: ScoreDb) }`
  - `createManual(input: CreateManualScoreInput): Promise<unknown>`
  - `ingest(input: IngestScoreInput): Promise<unknown>`
  - `listByTarget(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<unknown[]>`
  - `listByTenant(tenantId: string, filters: ScoreFilters): Promise<unknown[]>`
  - `delete(tenantId: string, id: string): Promise<void>`
  - Types `ScoreTargetType = 'MESSAGE'|'SESSION'`, `CreateManualScoreInput`, `IngestScoreInput`, `ScoreFilters`.

- [ ] **Step 1: Write the failing test** — `libs/shared/src/services/score-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoreService } from './score-service';

const mockDb = {
  scoreConfig: { findFirst: vi.fn() },
  score: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
  inferenceSessionMessage: { findFirst: vi.fn() },
  inferenceSession: { findFirst: vi.fn() },
};

const NUMERIC_CFG = { id: 'c1', tenantId: 't1', dataType: 'NUMERIC', minValue: 1, maxValue: 5, categories: null, isArchived: false };
const CAT_CFG = { id: 'c2', tenantId: 't1', dataType: 'CATEGORICAL', categories: [{ label: 'good', value: 1 }], isArchived: false };

describe('ScoreService', () => {
  let service: ScoreService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScoreService(mockDb as any);
  });

  it('creates a numeric manual score on a message (upsert: create path)', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.score.create.mockResolvedValue({ id: 's1' });

    await service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 4, authorUserId: 'u1' });

    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', messageId: 'm1', sessionId: null, numericValue: 4, stringValue: null, source: 'ANNOTATION', authorUserId: 'u1' }),
    });
  });

  it('updates an existing manual score by same author (upsert: update path)', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    mockDb.score.findFirst.mockResolvedValue({ id: 'existing' });
    mockDb.score.update.mockResolvedValue({ id: 'existing' });

    await service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 2, authorUserId: 'u1' });

    expect(mockDb.score.update).toHaveBeenCalledWith({ where: { id: 'existing' }, data: expect.objectContaining({ numericValue: 2 }) });
    expect(mockDb.score.create).not.toHaveBeenCalled();
  });

  it('rejects numeric value out of config range', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    await expect(
      service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 99, authorUserId: 'u1' }),
    ).rejects.toThrow(/range/i);
  });

  it('resolves categorical label to mapped numericValue', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(CAT_CFG);
    mockDb.inferenceSession.findFirst.mockResolvedValue({ id: 'sess1', tenantId: 't1' });
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.score.create.mockResolvedValue({ id: 's2' });

    await service.ingest({ tenantId: 't1', configId: 'c2', targetType: 'SESSION', targetId: 'sess1', value: 'good' });

    expect(mockDb.score.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetType: 'SESSION', sessionId: 'sess1', messageId: null, stringValue: 'good', numericValue: 1, source: 'API', authorUserId: null }),
    });
  });

  it('rejects a categorical value not in the config', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(CAT_CFG);
    mockDb.inferenceSession.findFirst.mockResolvedValue({ id: 'sess1', tenantId: 't1' });
    await expect(
      service.ingest({ tenantId: 't1', configId: 'c2', targetType: 'SESSION', targetId: 'sess1', value: 'bogus' }),
    ).rejects.toThrow(/categor/i);
  });

  it('rejects when target does not belong to tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(NUMERIC_CFG);
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue(null);
    await expect(
      service.createManual({ tenantId: 't1', configId: 'c1', targetType: 'MESSAGE', targetId: 'mX', value: 3, authorUserId: 'u1' }),
    ).rejects.toThrow(/target/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nx test shared -- score-service`
Expected: FAIL — cannot resolve `./score-service`.

- [ ] **Step 3: Implement `libs/shared/src/services/score-service.ts`**

```typescript
import { createLogger } from '../logging/logger';
import type { ScoreCategory, ScoreDataType } from './score-config-service';

const logger = createLogger('score-service');

export type ScoreTargetType = 'MESSAGE' | 'SESSION';
export type ScoreValue = number | string | boolean;

export interface CreateManualScoreInput {
  tenantId: string;
  configId: string;
  targetType: ScoreTargetType;
  targetId: string;
  value: ScoreValue;
  comment?: string;
  authorUserId: string;
}

export interface IngestScoreInput {
  tenantId: string;
  configId: string;
  targetType: ScoreTargetType;
  targetId: string;
  value: ScoreValue;
  comment?: string;
}

export interface ScoreFilters {
  configId?: string;
  targetType?: ScoreTargetType;
  source?: 'ANNOTATION' | 'API';
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

interface ScoreConfigRow {
  id: string;
  tenantId: string;
  dataType: ScoreDataType;
  minValue: number | null;
  maxValue: number | null;
  categories: ScoreCategory[] | null;
  isArchived: boolean;
}

export interface ScoreDb {
  scoreConfig: { findFirst(args: { where: Record<string, unknown> }): Promise<ScoreConfigRow | null> };
  score: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; skip?: number; include?: unknown }): Promise<unknown[]>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  inferenceSessionMessage: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<{ id: string; session: { tenantId: string } } | null> };
  inferenceSession: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
}

interface ResolvedValue { numericValue: number | null; stringValue: string | null; }

function resolveValue(config: ScoreConfigRow, value: ScoreValue): ResolvedValue {
  switch (config.dataType) {
    case 'NUMERIC': {
      if (typeof value !== 'number') throw new Error('NUMERIC score requires a numeric value');
      if ((config.minValue != null && value < config.minValue) || (config.maxValue != null && value > config.maxValue)) {
        throw new Error(`Score value out of range [${config.minValue}, ${config.maxValue}]`);
      }
      return { numericValue: value, stringValue: null };
    }
    case 'BOOLEAN': {
      const bool = typeof value === 'boolean' ? value : value === 'true' || value === 1;
      return { numericValue: bool ? 1 : 0, stringValue: bool ? 'true' : 'false' };
    }
    case 'CATEGORICAL': {
      const label = String(value);
      const match = (config.categories ?? []).find((c) => c.label === label);
      if (!match) throw new Error(`Categorical value "${label}" is not a defined category`);
      return { numericValue: match.value, stringValue: label };
    }
    default:
      throw new Error(`Unsupported dataType: ${config.dataType}`);
  }
}

export class ScoreService {
  constructor(private readonly db: ScoreDb) {}

  private async loadConfig(tenantId: string, configId: string): Promise<ScoreConfigRow> {
    const config = await this.db.scoreConfig.findFirst({ where: { id: configId, tenantId } });
    if (!config) throw new Error('Score config not found');
    return config;
  }

  private async assertTargetInTenant(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<void> {
    if (targetType === 'MESSAGE') {
      const msg = await this.db.inferenceSessionMessage.findFirst({ where: { id: targetId }, include: { session: { select: { tenantId: true } } } });
      if (!msg || msg.session.tenantId !== tenantId) throw new Error('Score target message not found in tenant');
    } else {
      const session = await this.db.inferenceSession.findFirst({ where: { id: targetId, tenantId } });
      if (!session) throw new Error('Score target session not found in tenant');
    }
  }

  private targetColumns(targetType: ScoreTargetType, targetId: string): { messageId: string | null; sessionId: string | null } {
    return targetType === 'MESSAGE' ? { messageId: targetId, sessionId: null } : { messageId: null, sessionId: targetId };
  }

  async createManual(input: CreateManualScoreInput): Promise<unknown> {
    try {
      const config = await this.loadConfig(input.tenantId, input.configId);
      await this.assertTargetInTenant(input.tenantId, input.targetType, input.targetId);
      const resolved = resolveValue(config, input.value);
      const cols = this.targetColumns(input.targetType, input.targetId);

      const existing = await this.db.score.findFirst({
        where: { tenantId: input.tenantId, configId: input.configId, authorUserId: input.authorUserId, ...cols },
      });

      const data = {
        ...resolved,
        comment: input.comment ?? null,
        source: 'ANNOTATION',
      };

      if (existing) {
        logger.info({ tenantId: input.tenantId, scoreId: existing.id, configId: input.configId }, 'Updating manual score');
        return await this.db.score.update({ where: { id: existing.id }, data });
      }
      logger.info({ tenantId: input.tenantId, configId: input.configId, targetType: input.targetType }, 'Creating manual score');
      return await this.db.score.create({
        data: { tenantId: input.tenantId, configId: input.configId, targetType: input.targetType, ...cols, ...data, authorUserId: input.authorUserId },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, configId: input.configId }, 'Failed to create manual score');
      throw error;
    }
  }

  async ingest(input: IngestScoreInput): Promise<unknown> {
    try {
      const config = await this.loadConfig(input.tenantId, input.configId);
      await this.assertTargetInTenant(input.tenantId, input.targetType, input.targetId);
      const resolved = resolveValue(config, input.value);
      const cols = this.targetColumns(input.targetType, input.targetId);
      logger.info({ tenantId: input.tenantId, configId: input.configId, targetType: input.targetType }, 'Ingesting API score');
      return await this.db.score.create({
        data: { tenantId: input.tenantId, configId: input.configId, targetType: input.targetType, ...cols, ...resolved, comment: input.comment ?? null, source: 'API', authorUserId: null },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, configId: input.configId }, 'Failed to ingest score');
      throw error;
    }
  }

  async listByTarget(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<unknown[]> {
    const cols = this.targetColumns(targetType, targetId);
    return this.db.score.findMany({ where: { tenantId, ...cols }, orderBy: { createdAt: 'desc' }, include: { config: true } });
  }

  async listByTenant(tenantId: string, filters: ScoreFilters): Promise<unknown[]> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.configId) where.configId = filters.configId;
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.source) where.source = filters.source;
    if (filters.fromDate || filters.toDate) {
      const range: Record<string, Date> = {};
      if (filters.fromDate) range.gte = new Date(filters.fromDate);
      if (filters.toDate) range.lte = new Date(`${filters.toDate}T23:59:59.999Z`);
      where.createdAt = range;
    }
    return this.db.score.findMany({ where, orderBy: { createdAt: 'desc' }, take: filters.limit ?? 50, skip: filters.offset ?? 0, include: { config: true } });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    try {
      const existing = await this.db.score.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error('Score not found');
      await this.db.score.delete({ where: { id } });
      logger.info({ tenantId, scoreId: id }, 'Deleted score');
    } catch (error) {
      logger.error({ err: error, tenantId, scoreId: id }, 'Failed to delete score');
      throw error;
    }
  }
}
```

- [ ] **Step 4: Export from `libs/shared/src/index.ts`**

```typescript
export { ScoreService } from './services/score-service';
export type { CreateManualScoreInput, IngestScoreInput, ScoreFilters, ScoreTargetType, ScoreValue } from './services/score-service';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `nx test shared -- score-service`
Expected: PASS (all 6 cases).

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/score-service.ts libs/shared/src/services/score-service.test.ts libs/shared/src/index.ts
git commit -m "feat(evaluation): add ScoreService"
```

---

### Task 6: DatasetService

**Files:**
- Create: `libs/shared/src/services/dataset-service.ts`
- Test: `libs/shared/src/services/dataset-service.test.ts`
- Modify: `libs/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `class DatasetService { constructor(db: DatasetDb) }`
  - `create(input: CreateDatasetInput): Promise<unknown>`
  - `list(tenantId: string): Promise<unknown[]>`
  - `get(tenantId: string, id: string): Promise<unknown | null>`
  - `update(tenantId: string, id: string, patch: UpdateDatasetInput): Promise<unknown>`
  - `delete(tenantId: string, id: string): Promise<void>`
  - Types `CreateDatasetInput`, `UpdateDatasetInput`.

- [ ] **Step 1: Write the failing test** — `libs/shared/src/services/dataset-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatasetService } from './dataset-service';

const mockDb = {
  dataset: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
};

describe('DatasetService', () => {
  let service: DatasetService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new DatasetService(mockDb as any);
  });

  it('creates a dataset', async () => {
    mockDb.dataset.create.mockResolvedValue({ id: 'd1' });
    await service.create({ tenantId: 't1', name: 'Regression set', createdBy: 'u1' });
    expect(mockDb.dataset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'Regression set', createdBy: 'u1' }),
    });
  });

  it('lists datasets with item counts', async () => {
    mockDb.dataset.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.dataset.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  });

  it('throws deleting a dataset from another tenant', async () => {
    mockDb.dataset.findFirst.mockResolvedValue(null);
    await expect(service.delete('t1', 'dX')).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nx test shared -- dataset-service`
Expected: FAIL — cannot resolve `./dataset-service`.

- [ ] **Step 3: Implement `libs/shared/src/services/dataset-service.ts`**

```typescript
import { createLogger } from '../logging/logger';

const logger = createLogger('dataset-service');

export interface CreateDatasetInput {
  tenantId: string;
  name: string;
  description?: string;
  metadata?: unknown;
  createdBy: string;
}
export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  metadata?: unknown;
}

export interface DatasetDb {
  dataset: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
}

export class DatasetService {
  constructor(private readonly db: DatasetDb) {}

  async create(input: CreateDatasetInput): Promise<unknown> {
    try {
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating dataset');
      return await this.db.dataset.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          metadata: (input.metadata ?? null) as never,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create dataset');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.dataset.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { items: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list datasets');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    return this.db.dataset.findFirst({ where: { id, tenantId }, include: { _count: { select: { items: true } } } });
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const existing = await this.db.dataset.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Dataset not found');
  }

  async update(tenantId: string, id: string, patch: UpdateDatasetInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      logger.info({ tenantId, id }, 'Updating dataset');
      return await this.db.dataset.update({ where: { id }, data: { ...patch, metadata: (patch.metadata ?? undefined) as never } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update dataset');
      throw error;
    }
  }

  async delete(tenantId: string, id: string): Promise<void> {
    try {
      await this.requireOwned(tenantId, id);
      await this.db.dataset.delete({ where: { id } });
      logger.info({ tenantId, id }, 'Deleted dataset');
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to delete dataset');
      throw error;
    }
  }
}
```

- [ ] **Step 4: Export from `libs/shared/src/index.ts`**

```typescript
export { DatasetService } from './services/dataset-service';
export type { CreateDatasetInput, UpdateDatasetInput } from './services/dataset-service';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `nx test shared -- dataset-service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/dataset-service.ts libs/shared/src/services/dataset-service.test.ts libs/shared/src/index.ts
git commit -m "feat(evaluation): add DatasetService"
```

---

### Task 7: DatasetItemService

**Files:**
- Create: `libs/shared/src/services/dataset-item-service.ts`
- Test: `libs/shared/src/services/dataset-item-service.test.ts`
- Modify: `libs/shared/src/index.ts`

**Interfaces:**
- Consumes: `ScoreTargetType` from `score-service`.
- Produces:
  - `class DatasetItemService { constructor(db: DatasetItemDb) }`
  - `create(tenantId: string, datasetId: string, input: CreateDatasetItemInput): Promise<unknown>`
  - `bulkCreate(tenantId: string, datasetId: string, rows: CreateDatasetItemInput[], createdBy: string): Promise<{ count: number }>`
  - `addFromTrace(input: AddFromTraceInput): Promise<unknown>`
  - `list(tenantId: string, datasetId: string, opts?: { includeArchived?: boolean }): Promise<unknown[]>`
  - `update(tenantId: string, datasetId: string, itemId: string, patch: UpdateDatasetItemInput): Promise<unknown>`
  - `archive(tenantId: string, datasetId: string, itemId: string): Promise<unknown>`
  - `delete(tenantId: string, datasetId: string, itemId: string): Promise<void>`
  - Types `CreateDatasetItemInput`, `UpdateDatasetItemInput`, `AddFromTraceInput`.

- [ ] **Step 1: Write the failing test** — `libs/shared/src/services/dataset-item-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatasetItemService } from './dataset-item-service';

const mockDb = {
  dataset: { findFirst: vi.fn() },
  datasetItem: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  inferenceSessionMessage: { findFirst: vi.fn() },
  inferenceSession: { findFirst: vi.fn() },
};

describe('DatasetItemService', () => {
  let service: DatasetItemService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new DatasetItemService(mockDb as any);
    mockDb.dataset.findFirst.mockResolvedValue({ id: 'd1', tenantId: 't1' });
  });

  it('creates an item after verifying dataset ownership', async () => {
    mockDb.datasetItem.create.mockResolvedValue({ id: 'i1' });
    await service.create('t1', 'd1', { input: { q: 'hi' }, expectedOutput: { a: 'hello' }, createdBy: 'u1' });
    expect(mockDb.datasetItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ datasetId: 'd1', createdBy: 'u1' }),
    });
  });

  it('throws when dataset belongs to another tenant', async () => {
    mockDb.dataset.findFirst.mockResolvedValue(null);
    await expect(service.create('t1', 'dX', { input: {}, createdBy: 'u1' })).rejects.toThrow(/dataset not found/i);
  });

  it('addFromTrace copies a message into input/expectedOutput with provenance', async () => {
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', role: 'assistant', content: 'The answer', session: { tenantId: 't1' } });
    mockDb.datasetItem.create.mockResolvedValue({ id: 'i2' });
    await service.addFromTrace({ tenantId: 't1', datasetId: 'd1', targetType: 'MESSAGE', targetId: 'm1', createdBy: 'u1' });
    expect(mockDb.datasetItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ datasetId: 'd1', sourceMessageId: 'm1', createdBy: 'u1' }),
    });
  });

  it('bulkCreate inserts many rows', async () => {
    mockDb.datasetItem.createMany.mockResolvedValue({ count: 3 });
    const rows = [{ input: { a: 1 } }, { input: { a: 2 } }, { input: { a: 3 } }];
    const res = await service.bulkCreate('t1', 'd1', rows as never, 'u1');
    expect(res).toEqual({ count: 3 });
    expect(mockDb.datasetItem.createMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nx test shared -- dataset-item-service`
Expected: FAIL — cannot resolve `./dataset-item-service`.

- [ ] **Step 3: Implement `libs/shared/src/services/dataset-item-service.ts`**

```typescript
import { createLogger } from '../logging/logger';
import type { ScoreTargetType } from './score-service';

const logger = createLogger('dataset-item-service');

export interface CreateDatasetItemInput {
  input: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
  sourceMessageId?: string;
  sourceSessionId?: string;
  createdBy: string;
}
export interface UpdateDatasetItemInput {
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
  status?: 'ACTIVE' | 'ARCHIVED';
}
export interface AddFromTraceInput {
  tenantId: string;
  datasetId: string;
  targetType: ScoreTargetType;
  targetId: string;
  createdBy: string;
}

export interface DatasetItemDb {
  dataset: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
  datasetItem: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  inferenceSessionMessage: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<{ id: string; role: string; content: string; session: { tenantId: string } } | null> };
  inferenceSession: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<{ id: string; tenantId: string; messages?: Array<{ role: string; content: string }> } | null> };
}

export class DatasetItemService {
  constructor(private readonly db: DatasetItemDb) {}

  private async requireDataset(tenantId: string, datasetId: string): Promise<void> {
    const ds = await this.db.dataset.findFirst({ where: { id: datasetId, tenantId } });
    if (!ds) throw new Error('Dataset not found');
  }

  async create(tenantId: string, datasetId: string, input: CreateDatasetItemInput): Promise<unknown> {
    try {
      await this.requireDataset(tenantId, datasetId);
      logger.info({ tenantId, datasetId }, 'Creating dataset item');
      return await this.db.datasetItem.create({
        data: {
          datasetId,
          input: input.input as never,
          expectedOutput: (input.expectedOutput ?? null) as never,
          metadata: (input.metadata ?? null) as never,
          sourceMessageId: input.sourceMessageId ?? null,
          sourceSessionId: input.sourceSessionId ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId }, 'Failed to create dataset item');
      throw error;
    }
  }

  async bulkCreate(tenantId: string, datasetId: string, rows: CreateDatasetItemInput[], createdBy: string): Promise<{ count: number }> {
    try {
      await this.requireDataset(tenantId, datasetId);
      logger.info({ tenantId, datasetId, count: rows.length }, 'Bulk-creating dataset items');
      return await this.db.datasetItem.createMany({
        data: rows.map((r) => ({
          datasetId,
          input: r.input as never,
          expectedOutput: (r.expectedOutput ?? null) as never,
          metadata: (r.metadata ?? null) as never,
          createdBy,
        })),
      });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId }, 'Failed to bulk-create dataset items');
      throw error;
    }
  }

  async addFromTrace(input: AddFromTraceInput): Promise<unknown> {
    try {
      await this.requireDataset(input.tenantId, input.datasetId);
      if (input.targetType === 'MESSAGE') {
        const msg = await this.db.inferenceSessionMessage.findFirst({ where: { id: input.targetId }, include: { session: { select: { tenantId: true } } } });
        if (!msg || msg.session.tenantId !== input.tenantId) throw new Error('Trace message not found in tenant');
        return await this.create(input.tenantId, input.datasetId, {
          input: { role: msg.role, content: msg.content },
          expectedOutput: msg.role === 'assistant' ? { content: msg.content } : null,
          sourceMessageId: msg.id,
          createdBy: input.createdBy,
        });
      }
      const session = await this.db.inferenceSession.findFirst({ where: { id: input.targetId, tenantId: input.tenantId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      if (!session) throw new Error('Trace session not found in tenant');
      const msgs = session.messages ?? [];
      const firstUser = msgs.find((m) => m.role === 'user');
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      return await this.create(input.tenantId, input.datasetId, {
        input: { content: firstUser?.content ?? '' },
        expectedOutput: lastAssistant ? { content: lastAssistant.content } : null,
        sourceSessionId: session.id,
        createdBy: input.createdBy,
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, datasetId: input.datasetId }, 'Failed to add item from trace');
      throw error;
    }
  }

  async list(tenantId: string, datasetId: string, opts?: { includeArchived?: boolean }): Promise<unknown[]> {
    await this.requireDataset(tenantId, datasetId);
    const where: Record<string, unknown> = { datasetId };
    if (!opts?.includeArchived) where.status = 'ACTIVE';
    return this.db.datasetItem.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  private async requireItem(tenantId: string, datasetId: string, itemId: string): Promise<void> {
    await this.requireDataset(tenantId, datasetId);
    const item = await this.db.datasetItem.findFirst({ where: { id: itemId, datasetId } });
    if (!item) throw new Error('Dataset item not found');
  }

  async update(tenantId: string, datasetId: string, itemId: string, patch: UpdateDatasetItemInput): Promise<unknown> {
    try {
      await this.requireItem(tenantId, datasetId, itemId);
      return await this.db.datasetItem.update({
        where: { id: itemId },
        data: {
          ...(patch.input !== undefined ? { input: patch.input as never } : {}),
          ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput as never } : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata as never } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId, itemId }, 'Failed to update dataset item');
      throw error;
    }
  }

  async archive(tenantId: string, datasetId: string, itemId: string): Promise<unknown> {
    return this.update(tenantId, datasetId, itemId, { status: 'ARCHIVED' });
  }

  async delete(tenantId: string, datasetId: string, itemId: string): Promise<void> {
    try {
      await this.requireItem(tenantId, datasetId, itemId);
      await this.db.datasetItem.delete({ where: { id: itemId } });
      logger.info({ tenantId, datasetId, itemId }, 'Deleted dataset item');
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId, itemId }, 'Failed to delete dataset item');
      throw error;
    }
  }
}
```

- [ ] **Step 4: Export from `libs/shared/src/index.ts`**

```typescript
export { DatasetItemService } from './services/dataset-item-service';
export type { CreateDatasetItemInput, UpdateDatasetItemInput, AddFromTraceInput } from './services/dataset-item-service';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `nx test shared -- dataset-item-service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/services/dataset-item-service.ts libs/shared/src/services/dataset-item-service.test.ts libs/shared/src/index.ts
git commit -m "feat(evaluation): add DatasetItemService"
```

---

### Task 8: Dashboard API — score configs

**Files:**
- Create: `apps/web-ui/app/api/evaluation/score-configs/route.ts`
- Create: `apps/web-ui/app/api/evaluation/score-configs/[id]/route.ts`

**Interfaces:**
- Consumes: `ScoreConfigService`, `getSessionTenantId`, `getSessionUserId`, `authorize`, `getPrismaClient` from `@chatbot/shared`; `scoreConfigCreateSchema`, `scoreConfigUpdateSchema`, `parseJson`, `ValidationError`.
- Produces: REST endpoints `GET/POST /api/evaluation/score-configs`, `GET/PATCH/DELETE /api/evaluation/score-configs/[id]`.

- [ ] **Step 1: Implement the collection route** — `apps/web-ui/app/api/evaluation/score-configs/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, ScoreConfigService } from '@chatbot/shared';
import { scoreConfigCreateSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@chatbot/shared';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:score-configs');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const includeArchived = new URL(req.url).searchParams.get('includeArchived') === 'true';
    const service = new ScoreConfigService(getPrismaClient());
    const configs = await service.list(tenantId, { includeArchived });
    return NextResponse.json({ configs });
  } catch (error) {
    return handleError(error, 'list score configs');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, scoreConfigCreateSchema);
    const service = new ScoreConfigService(getPrismaClient());
    const config = await service.create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    return handleError(error, 'create score config');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  }
  if (error instanceof Error && error.message.includes('Unauthenticated')) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

- [ ] **Step 2: Implement the item route** — `apps/web-ui/app/api/evaluation/score-configs/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ScoreConfigService } from '@chatbot/shared';
import { scoreConfigUpdateSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@chatbot/shared';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:score-configs:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const config = await new ScoreConfigService(getPrismaClient()).get(tenantId, id);
    if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ config });
  } catch (error) {
    return handleError(error, 'get score config');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, scoreConfigUpdateSchema);
    const config = await new ScoreConfigService(getPrismaClient()).update(tenantId, id, body);
    return NextResponse.json({ config });
  } catch (error) {
    return handleError(error, 'update score config');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'ScoreConfig', authOptions);
    if (authError) return authError;
    const config = await new ScoreConfigService(getPrismaClient()).archive(tenantId, id);
    return NextResponse.json({ config });
  } catch (error) {
    return handleError(error, 'archive score config');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

> Confirmed exported from `@chatbot/shared`: `createLogger`, `getSessionTenantId`, `getSessionUserId`, `getPrismaClient`, `authorize`. No index changes needed for these — only the new service exports added in Tasks 4–7.

- [ ] **Step 3: Verify the app type-checks**

Run: `nx build web-ui --configuration=development 2>&1 | tail -20` (or `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`)
Expected: no type errors in the new files.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/evaluation/score-configs libs/shared/src/index.ts
git commit -m "feat(evaluation): score-config dashboard API routes"
```

---

### Task 9: Dashboard API — scores

**Files:**
- Create: `apps/web-ui/app/api/evaluation/scores/route.ts`
- Create: `apps/web-ui/app/api/evaluation/scores/[id]/route.ts`

**Interfaces:**
- Consumes: `ScoreService`, `scoreManualCreateSchema`, `scoreListQuerySchema`, `parseJson`, `parseSearchParams`, `ValidationError`, auth helpers.
- Produces: `GET/POST /api/evaluation/scores`, `DELETE /api/evaluation/scores/[id]`.

- [ ] **Step 1: Implement the collection route** — `apps/web-ui/app/api/evaluation/scores/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, ScoreService, createLogger } from '@chatbot/shared';
import { scoreManualCreateSchema, scoreListQuerySchema, parseJson, parseSearchParams, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:scores');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Score', authOptions);
    if (authError) return authError;
    const filters = parseSearchParams(new URL(req.url).searchParams, scoreListQuerySchema);
    const scores = await new ScoreService(getPrismaClient()).listByTenant(tenantId, filters);
    return NextResponse.json({ scores });
  } catch (error) {
    return handleError(error, 'list scores');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Score', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, scoreManualCreateSchema);
    const score = await new ScoreService(getPrismaClient()).createManual({ ...body, tenantId, authorUserId: userId });
    return NextResponse.json({ score }, { status: 201 });
  } catch (error) {
    return handleError(error, 'create score');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof Error && /(range|categor|requires)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 422 });
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

- [ ] **Step 2: Implement the item route** — `apps/web-ui/app/api/evaluation/scores/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, ScoreService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:scores:id');

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Score', authOptions);
    if (authError) return authError;
    await new ScoreService(getPrismaClient()).delete(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
    logger.error({ err: error }, 'Failed to delete score');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify type-check** — Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json` — Expected: no errors in new files.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/evaluation/scores
git commit -m "feat(evaluation): scores dashboard API routes"
```

---

### Task 10: Dashboard API — datasets + items

**Files:**
- Create: `apps/web-ui/app/api/evaluation/datasets/route.ts`
- Create: `apps/web-ui/app/api/evaluation/datasets/[id]/route.ts`
- Create: `apps/web-ui/app/api/evaluation/datasets/[id]/items/route.ts`
- Create: `apps/web-ui/app/api/evaluation/datasets/[id]/items/[itemId]/route.ts`
- Create: `apps/web-ui/app/api/evaluation/datasets/[id]/items/from-trace/route.ts`

**Interfaces:**
- Consumes: `DatasetService`, `DatasetItemService`, `datasetCreateSchema`, `datasetUpdateSchema`, `datasetItemCreateSchema`, `datasetItemBulkSchema`, `addFromTraceSchema`, auth helpers.
- Produces: dataset + item REST endpoints.

- [ ] **Step 1: Datasets collection** — `apps/web-ui/app/api/evaluation/datasets/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, DatasetService, createLogger } from '@chatbot/shared';
import { datasetCreateSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:datasets');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dataset', authOptions);
    if (authError) return authError;
    const datasets = await new DatasetService(getPrismaClient()).list(tenantId);
    return NextResponse.json({ datasets });
  } catch (error) {
    return evalError(error, logger, 'list datasets');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Dataset', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, datasetCreateSchema);
    const dataset = await new DatasetService(getPrismaClient()).create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    return evalError(error, logger, 'create dataset');
  }
}

// shared error helper used by all evaluation dataset routes
export function evalError(error: unknown, log: ReturnType<typeof createLogger>, action: string): NextResponse {
  if (error instanceof ValidationError) return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
  log.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

- [ ] **Step 2: Dataset item route** — `apps/web-ui/app/api/evaluation/datasets/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DatasetService, createLogger } from '@chatbot/shared';
import { datasetUpdateSchema, parseJson } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:datasets:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dataset', authOptions);
    if (authError) return authError;
    const dataset = await new DatasetService(getPrismaClient()).get(tenantId, id);
    if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ dataset });
  } catch (error) { return evalError(error, logger, 'get dataset'); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dataset', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, datasetUpdateSchema);
    const dataset = await new DatasetService(getPrismaClient()).update(tenantId, id, body);
    return NextResponse.json({ dataset });
  } catch (error) { return evalError(error, logger, 'update dataset'); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Dataset', authOptions);
    if (authError) return authError;
    await new DatasetService(getPrismaClient()).delete(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return evalError(error, logger, 'delete dataset'); }
}
```

- [ ] **Step 3: Items collection (single + bulk)** — `apps/web-ui/app/api/evaluation/datasets/[id]/items/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, DatasetItemService, createLogger } from '@chatbot/shared';
import { datasetItemCreateSchema, datasetItemBulkSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-items');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'DatasetItem', authOptions);
    if (authError) return authError;
    const includeArchived = new URL(req.url).searchParams.get('includeArchived') === 'true';
    const items = await new DatasetItemService(getPrismaClient()).list(tenantId, id, { includeArchived });
    return NextResponse.json({ items });
  } catch (error) { return evalError(error, logger, 'list dataset items'); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'DatasetItem', authOptions);
    if (authError) return authError;
    const raw = await req.json();
    const service = new DatasetItemService(getPrismaClient());
    if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
      const parsed = datasetItemBulkSchema.safeParse(raw);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const result = await service.bulkCreate(tenantId, id, parsed.data.items.map((i) => ({ ...i, createdBy: userId })), userId);
      return NextResponse.json({ result }, { status: 201 });
    }
    const parsed = datasetItemCreateSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const item = await service.create(tenantId, id, { ...parsed.data, createdBy: userId });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return evalError(error, logger, 'create dataset item'); }
}
```

- [ ] **Step 4: Item detail (PATCH/DELETE)** — `apps/web-ui/app/api/evaluation/datasets/[id]/items/[itemId]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DatasetItemService, createLogger } from '@chatbot/shared';
import { parseJson } from '@chatbot/shared';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-item');

const itemPatchSchema = z.object({
  input: z.unknown().optional(),
  expectedOutput: z.unknown().optional(),
  metadata: z.unknown().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'DatasetItem', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, itemPatchSchema);
    const item = await new DatasetItemService(getPrismaClient()).update(tenantId, id, itemId, body);
    return NextResponse.json({ item });
  } catch (error) { return evalError(error, logger, 'update dataset item'); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'DatasetItem', authOptions);
    if (authError) return authError;
    await new DatasetItemService(getPrismaClient()).delete(tenantId, id, itemId);
    return NextResponse.json({ ok: true });
  } catch (error) { return evalError(error, logger, 'delete dataset item'); }
}
```

- [ ] **Step 5: Add-from-trace** — `apps/web-ui/app/api/evaluation/datasets/[id]/items/from-trace/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, DatasetItemService, createLogger } from '@chatbot/shared';
import { addFromTraceSchema, parseJson } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../../route';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dataset-from-trace');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'DatasetItem', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, addFromTraceSchema);
    const item = await new DatasetItemService(getPrismaClient()).addFromTrace({ ...body, tenantId, datasetId: id, createdBy: userId });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return evalError(error, logger, 'add item from trace'); }
}
```

- [ ] **Step 6: Verify type-check** — Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json` — Expected: no errors in new files.

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/app/api/evaluation/datasets
git commit -m "feat(evaluation): datasets + items dashboard API routes"
```

---

### Task 11: Ingestion API — `POST /api/v1/scores`

**Files:**
- Create: `apps/web-ui/app/api/v1/scores/lib/auth.ts`
- Create: `apps/web-ui/app/api/v1/scores/route.ts`
- Modify: `libs/shared/src/services/api-key-service.ts` (add `scores:write` to the known-scopes list/comment if one exists; otherwise no change needed — scopes is a free `String[]`)

**Interfaces:**
- Consumes: `ScoreService`, `scoreIngestSchema`, `getPrismaClient`, `createLogger`.
- Produces: `POST /api/v1/scores` (Bearer API key + `scores:write` scope) and `validateScoreApiKey(req)`.

- [ ] **Step 1: Implement the scoped auth helper** — `apps/web-ui/app/api/v1/scores/lib/auth.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';
import crypto from 'crypto';

export interface ScoreAuthResult { tenantId: string; apiKeyId: string; }

export async function validateScoreApiKey(
  req: NextRequest,
): Promise<{ success: true; auth: ScoreAuthResult } | { success: false; response: NextResponse }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'Missing or invalid Authorization header' } }, { status: 401 }) };
  }
  const rawKey = authHeader.slice(7);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const db = getPrismaClient();
  const apiKey = await db.apiKey.findFirst({ where: { keyHash } }) as { id: string; tenantId: string; status: string; expiresAt: Date | null; scopes: string[] } | null;

  if (!apiKey) return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'API key not found' } }, { status: 401 }) };
  if (apiKey.status === 'revoked') return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'API key has been revoked' } }, { status: 401 }) };
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'API key has expired' } }, { status: 401 }) };
  if (!apiKey.scopes?.includes('scores:write')) {
    return { success: false, response: NextResponse.json({ error: { type: 'insufficient_scope', message: 'API key missing scores:write scope' } }, { status: 403 }) };
  }
  return { success: true, auth: { tenantId: apiKey.tenantId, apiKeyId: apiKey.id } };
}
```

- [ ] **Step 2: Implement the route** — `apps/web-ui/app/api/v1/scores/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, ScoreService, createLogger } from '@chatbot/shared';
import { scoreIngestSchema, ValidationError } from '@chatbot/shared';
import { validateScoreApiKey } from './lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:v1:scores');

export async function POST(req: NextRequest) {
  try {
    const authResult = await validateScoreApiKey(req);
    if (!authResult.success) return authResult.response;
    const { tenantId } = authResult.auth;

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: { type: 'invalid_body', message: 'Invalid JSON' } }, { status: 422 }); }
    const parsed = scoreIngestSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });

    const score = await new ScoreService(getPrismaClient()).ingest({ ...parsed.data, tenantId });
    return NextResponse.json({ score }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: { type: 'validation_error', issues: error.issues } }, { status: 422 });
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    if (error instanceof Error && /(range|categor|requires)/i.test(error.message)) return NextResponse.json({ error: { type: 'validation_error', message: error.message } }, { status: 422 });
    logger.error({ err: error }, 'Failed to ingest score');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

- [ ] **Step 3: Surface `scores:write` in the API-key UI scope options.** Grep for where scopes are offered when creating an API key (`grep -rn "inference:read" apps/web-ui`). Add `scores:write` (label "Write evaluation scores") to that option list. If no UI list exists, skip — `scopes` accepts arbitrary strings.

- [ ] **Step 4: Verify type-check** — Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json` — Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/app/api/v1/scores apps/web-ui/components 2>/dev/null; git commit -m "feat(evaluation): score ingestion API (POST /api/v1/scores)"
```

---

### Task 12: Sidebar navigation — Evaluation group

**Files:**
- Modify: `apps/web-ui/components/layout/app-sidebar.tsx`

**Interfaces:**
- Consumes: existing `Collapsible` sidebar pattern.
- Produces: an "Evaluation" group linking `/evaluation/scores` and `/evaluation/datasets`.

- [ ] **Step 1: Add the nav config + icon import.** In the lucide import block add `ClipboardCheck` and `ListChecks`. After `const analyticsNav = [...]` add:

```typescript
const evaluationNav = [
  { name: 'Scores', href: '/evaluation/scores', icon: ClipboardCheck },
  { name: 'Datasets', href: '/evaluation/datasets', icon: ListChecks },
];
```

- [ ] **Step 2: Add open-state tracking** (near the other `useState` active flags):

```typescript
  const isEvaluationActive = pathname === '/evaluation' || pathname.startsWith('/evaluation/');
  const [evaluationOpen, setEvaluationOpen] = useState(isEvaluationActive);
```

- [ ] **Step 3: Add the group JSX** immediately after the Analytics `</SidebarGroup>`:

```tsx
        <SidebarGroup>
          <SidebarGroupLabel>Evaluation</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible open={evaluationOpen} onOpenChange={setEvaluationOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton tooltip="Evaluation">
                      <ClipboardCheck className="size-4" />
                      <span>Evaluation</span>
                      <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {evaluationNav.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton isActive={isActive} onClick={() => router.push(item.href)}>
                            <item.icon className="size-3.5" />
                            <span>{item.name}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>
```

- [ ] **Step 4: Verify it renders** — Run: `bun run dev` and visit `/dashboard`; confirm the Evaluation group appears and expands. (Or `bunx tsc --noEmit -p apps/web-ui/tsconfig.json` for a type-only check.)

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/layout/app-sidebar.tsx
git commit -m "feat(evaluation): add Evaluation sidebar group"
```

---

### Task 13: UI — Scores page (with Configs tab)

**Files:**
- Create: `apps/web-ui/app/(dashboard)/evaluation/scores/page.tsx`

**Interfaces:**
- Consumes: `/api/evaluation/scores`, `/api/evaluation/score-configs` endpoints; shadcn `Tabs`, `Table`, `Dialog`, `Select`, `Input`, `Button`, `Badge`.
- Produces: the Scores + Score Configs management screen.

- [ ] **Step 1: Confirm required shadcn components exist.** Run: `ls apps/web-ui/components/ui/{tabs,table,dialog,select,input,button,badge,textarea,label}.tsx`. For any missing component, add it via the project's shadcn workflow (see `new-component` skill / `bun run` shadcn add). Most already exist.

- [ ] **Step 2: Implement the page** — `apps/web-ui/app/(dashboard)/evaluation/scores/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { scoreConfigCreateSchema } from '@chatbot/shared';

interface ScoreConfig { id: string; name: string; dataType: string; minValue: number | null; maxValue: number | null; categories: { label: string; value: number }[] | null; isArchived: boolean; }
interface ScoreRow { id: string; targetType: string; numericValue: number | null; stringValue: string | null; source: string; comment: string | null; createdAt: string; config: { name: string; dataType: string }; messageId: string | null; sessionId: string | null; }

export default function ScoresPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Evaluation Scores</h1>
        <p className="text-sm text-muted-foreground">Grade real conversations and manage your score definitions.</p>
      </div>
      <Tabs defaultValue="scores">
        <TabsList>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="configs">Score Configs</TabsTrigger>
        </TabsList>
        <TabsContent value="scores"><ScoresTab /></TabsContent>
        <TabsContent value="configs"><ConfigsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ScoresTab() {
  const { data, isLoading } = useQuery<{ scores: ScoreRow[] }>({
    queryKey: ['eval-scores'],
    queryFn: async () => (await fetch('/api/evaluation/scores')).json(),
  });
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (id: string) => fetch(`/api/evaluation/scores/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-scores'] }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-8">Loading…</p>;
  const scores = data?.scores ?? [];
  if (scores.length === 0) return <p className="text-sm text-muted-foreground py-8">No scores yet. Score a conversation from its detail page.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Config</TableHead><TableHead>Value</TableHead><TableHead>Target</TableHead><TableHead>Source</TableHead><TableHead>Comment</TableHead><TableHead></TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {scores.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.config?.name}</TableCell>
            <TableCell>{s.stringValue ?? s.numericValue}</TableCell>
            <TableCell><Badge variant="outline">{s.targetType}</Badge></TableCell>
            <TableCell><Badge variant={s.source === 'API' ? 'secondary' : 'default'}>{s.source}</Badge></TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{s.comment}</TableCell>
            <TableCell><Button variant="ghost" size="icon" onClick={() => del.mutate(s.id)}><Trash2 className="size-4" /></Button></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConfigsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ configs: ScoreConfig[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataType, setDataType] = useState<'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN'>('NUMERIC');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [categoriesText, setCategoriesText] = useState('good=1\nbad=0');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { name, description: description || undefined, dataType };
      if (dataType === 'NUMERIC') { if (minValue) payload.minValue = Number(minValue); if (maxValue) payload.maxValue = Number(maxValue); }
      if (dataType === 'CATEGORICAL') {
        payload.categories = categoriesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [label, value] = l.split('='); return { label: label.trim(), value: Number(value) };
        });
      }
      const parsed = scoreConfigCreateSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const res = await fetch('/api/evaluation/score-configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setOpen(false); setName(''); setError(null); qc.invalidateQueries({ queryKey: ['eval-score-configs'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => fetch(`/api/evaluation/score-configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-score-configs'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="size-4 mr-1" /> New config</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>New score config</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="helpfulness" /></div>
              <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div>
                <Label>Data type</Label>
                <Select value={dataType} onValueChange={(v) => setDataType(v as typeof dataType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NUMERIC">Numeric</SelectItem>
                    <SelectItem value="CATEGORICAL">Categorical</SelectItem>
                    <SelectItem value="BOOLEAN">Boolean</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {dataType === 'NUMERIC' && (
                <div className="flex gap-2">
                  <div><Label>Min</Label><Input type="number" value={minValue} onChange={(e) => setMinValue(e.target.value)} /></div>
                  <div><Label>Max</Label><Input type="number" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} /></div>
                </div>
              )}
              {dataType === 'CATEGORICAL' && (
                <div><Label>Categories (one `label=value` per line)</Label><Textarea value={categoriesText} onChange={(e) => setCategoriesText(e.target.value)} rows={4} /></div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !name}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground py-8">Loading…</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Range / Categories</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.configs ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline">{c.dataType}</Badge></TableCell>
                <TableCell className="text-muted-foreground">
                  {c.dataType === 'NUMERIC' ? `${c.minValue ?? '−∞'} … ${c.maxValue ?? '∞'}` : c.dataType === 'CATEGORICAL' ? (c.categories ?? []).map((x) => x.label).join(', ') : 'true / false'}
                </TableCell>
                <TableCell><Button variant="ghost" size="sm" onClick={() => archive.mutate(c.id)}>Archive</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify** — Run: `bun run dev`, visit `/evaluation/scores`, create a NUMERIC config, confirm it appears in the Configs tab. Type-check: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/evaluation/scores"
git commit -m "feat(evaluation): scores + configs dashboard page"
```

---

### Task 14: UI — Datasets list + detail

**Files:**
- Create: `apps/web-ui/app/(dashboard)/evaluation/datasets/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/evaluation/datasets/[id]/page.tsx`

**Interfaces:**
- Consumes: `/api/evaluation/datasets`, `/api/evaluation/datasets/[id]`, `/api/evaluation/datasets/[id]/items`.
- Produces: dataset list (with create dialog) + detail (items table, add-item dialog, JSON/CSV import).

- [ ] **Step 1: Datasets list** — `apps/web-ui/app/(dashboard)/evaluation/datasets/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Database } from 'lucide-react';

interface DatasetRow { id: string; name: string; description: string | null; _count?: { items: number }; createdAt: string; }

export default function DatasetsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ datasets: DatasetRow[] }>({
    queryKey: ['eval-datasets'],
    queryFn: async () => (await fetch('/api/evaluation/datasets')).json(),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/evaluation/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: description || undefined }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      return res.json();
    },
    onSuccess: () => { setOpen(false); setName(''); setDescription(''); setError(null); qc.invalidateQueries({ queryKey: ['eval-datasets'] }); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Datasets</h1><p className="text-sm text-muted-foreground">Curated collections of evaluation items.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="size-4 mr-1" /> New dataset</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>New dataset</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !name}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data?.datasets ?? []).map((d) => (
            <Card key={d.id} className="cursor-pointer hover:border-primary" onClick={() => router.push(`/evaluation/datasets/${d.id}`)}>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="size-4" /> {d.name}</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground line-clamp-2">{d.description}</p><p className="text-xs mt-2">{d._count?.items ?? 0} items</p></CardContent>
            </Card>
          ))}
          {(data?.datasets ?? []).length === 0 && <p className="text-sm text-muted-foreground">No datasets yet.</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Dataset detail** — `apps/web-ui/app/(dashboard)/evaluation/datasets/[id]/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ChevronLeft, Plus, Upload, Trash2 } from 'lucide-react';

interface DatasetItem { id: string; input: unknown; expectedOutput: unknown; status: string; createdAt: string; }

function parseMaybeJson(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }

export default function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: dsData } = useQuery<{ dataset: { name: string; description: string | null } }>({ queryKey: ['eval-dataset', id], queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}`)).json() });
  const { data, isLoading } = useQuery<{ items: DatasetItem[] }>({ queryKey: ['eval-dataset-items', id], queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}/items`)).json() });

  const [addOpen, setAddOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['eval-dataset-items', id] });

  const addItem = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evaluation/datasets/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: parseMaybeJson(inputText), expectedOutput: expectedText ? parseMaybeJson(expectedText) : undefined }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setAddOpen(false); setInputText(''); setExpectedText(''); setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  const importItems = useMutation({
    mutationFn: async () => {
      // Accepts a JSON array of { input, expectedOutput? } objects.
      const rows = JSON.parse(importText);
      if (!Array.isArray(rows)) throw new Error('Import must be a JSON array');
      const res = await fetch(`/api/evaluation/datasets/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: rows }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setImportOpen(false); setImportText(''); setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  const del = useMutation({
    mutationFn: async (itemId: string) => fetch(`/api/evaluation/datasets/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div className="p-6 space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/evaluation/datasets')}><ChevronLeft className="size-4 mr-1" /> Datasets</Button>
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">{dsData?.dataset?.name}</h1><p className="text-sm text-muted-foreground">{dsData?.dataset?.description}</p></div>
        <div className="flex gap-2">
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger render={<Button variant="outline"><Upload className="size-4 mr-1" /> Import</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Import items (JSON array)</DialogTitle></DialogHeader>
              <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"input": {"q": "hi"}, "expectedOutput": {"a": "hello"}}]' />
              {err && <p className="text-sm text-destructive">{err}</p>}
              <DialogFooter><Button onClick={() => importItems.mutate()} disabled={importItems.isPending}>Import</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger render={<Button><Plus className="size-4 mr-1" /> Add item</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Add item</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Input (text or JSON)</Label><Textarea rows={4} value={inputText} onChange={(e) => setInputText(e.target.value)} /></div>
                <div><Label>Expected output (optional)</Label><Textarea rows={4} value={expectedText} onChange={(e) => setExpectedText(e.target.value)} /></div>
                {err && <p className="text-sm text-destructive">{err}</p>}
              </div>
              <DialogFooter><Button onClick={() => addItem.mutate()} disabled={addItem.isPending || !inputText}>Add</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Input</TableHead><TableHead>Expected output</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.items ?? []).map((it) => (
              <TableRow key={it.id}>
                <TableCell className="max-w-md truncate font-mono text-xs">{JSON.stringify(it.input)}</TableCell>
                <TableCell className="max-w-md truncate font-mono text-xs">{JSON.stringify(it.expectedOutput)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => del.mutate(it.id)}><Trash2 className="size-4" /></Button></TableCell>
              </TableRow>
            ))}
            {(data?.items ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No items yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

> CSV import is satisfied by the JSON-array importer for this slice; document CSV-to-JSON as a follow-up if raw CSV upload is later required.

- [ ] **Step 3: Verify** — `bun run dev`, create a dataset, open it, add an item and import a 2-row JSON array; confirm rows appear. Type-check: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/evaluation/datasets"
git commit -m "feat(evaluation): datasets list + detail pages"
```

---

### Task 15: UI — inline scoring drawer on inference detail

**Files:**
- Create: `apps/web-ui/components/evaluation/score-drawer.tsx`
- Modify: `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx`

**Interfaces:**
- Consumes: `/api/evaluation/score-configs`, `/api/evaluation/scores`, `/api/evaluation/datasets`, `/api/evaluation/datasets/[id]/items/from-trace`; shadcn `Sheet`, `Select`, `Input`, `Button`.
- Produces: a `<ScoreDrawer sessionId={...} />` component mounted on the inference detail page; records a SESSION-targeted score + supports "Add to dataset".

- [ ] **Step 1: Confirm the `sheet` component exists.** Run: `ls apps/web-ui/components/ui/sheet.tsx`. If missing, add it via the shadcn workflow.

- [ ] **Step 2: Implement the drawer** — `apps/web-ui/components/evaluation/score-drawer.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck } from 'lucide-react';

interface ScoreConfig { id: string; name: string; dataType: string; categories: { label: string; value: number }[] | null; }
interface Dataset { id: string; name: string; }

export function ScoreDrawer({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const { data: cfgData } = useQuery<{ configs: ScoreConfig[] }>({ queryKey: ['eval-score-configs'], queryFn: async () => (await fetch('/api/evaluation/score-configs')).json() });
  const { data: dsData } = useQuery<{ datasets: Dataset[] }>({ queryKey: ['eval-datasets'], queryFn: async () => (await fetch('/api/evaluation/datasets')).json() });
  const { data: existing } = useQuery<{ scores: { id: string; config: { name: string }; numericValue: number | null; stringValue: string | null }[] }>({
    queryKey: ['eval-scores', 'SESSION', sessionId],
    queryFn: async () => (await fetch(`/api/evaluation/scores?targetType=SESSION`)).json(),
  });

  const [configId, setConfigId] = useState('');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const configs = cfgData?.configs ?? [];
  const selected = configs.find((c) => c.id === configId);

  const submit = useMutation({
    mutationFn: async () => {
      let parsedValue: number | string | boolean = value;
      if (selected?.dataType === 'NUMERIC') parsedValue = Number(value);
      if (selected?.dataType === 'BOOLEAN') parsedValue = value === 'true';
      const res = await fetch('/api/evaluation/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId, targetType: 'SESSION', targetId: sessionId, value: parsedValue, comment: comment || undefined }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setMsg('Score saved'); setValue(''); setComment(''); qc.invalidateQueries({ queryKey: ['eval-scores', 'SESSION', sessionId] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  const addToDataset = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evaluation/datasets/${datasetId}/items/from-trace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'SESSION', targetId: sessionId }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => setMsg('Added to dataset'),
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm"><ClipboardCheck className="size-4 mr-1" /> Score</Button>} />
      <SheetContent className="w-[400px] sm:max-w-[400px]">
        <SheetHeader><SheetTitle>Evaluate session</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-4 px-1">
          <div>
            <Label>Score config</Label>
            <Select value={configId} onValueChange={setConfigId}>
              <SelectTrigger><SelectValue placeholder="Pick a config" /></SelectTrigger>
              <SelectContent>{configs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.dataType})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selected?.dataType === 'CATEGORICAL' ? (
            <div><Label>Value</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>{(selected.categories ?? []).map((c) => <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : selected?.dataType === 'BOOLEAN' ? (
            <div><Label>Value</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
              </Select>
            </div>
          ) : (
            <div><Label>Value</Label><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          )}
          <div><Label>Comment</Label><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <Button onClick={() => submit.mutate()} disabled={!configId || value === '' || submit.isPending} className="w-full">Save score</Button>

          <div className="border-t pt-4">
            <Label>Add this session to a dataset</Label>
            <div className="flex gap-2 mt-1">
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger><SelectValue placeholder="Pick dataset" /></SelectTrigger>
                <SelectContent>{(dsData?.datasets ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" onClick={() => addToDataset.mutate()} disabled={!datasetId || addToDataset.isPending}>Add</Button>
            </div>
          </div>

          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

          <div className="border-t pt-4">
            <Label>Existing session scores</Label>
            <div className="space-y-1 mt-2">
              {(existing?.scores ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span>{s.config?.name}</span>
                  <Badge variant="outline">{s.stringValue ?? s.numericValue}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Mount it on the inference detail page.** In `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx`, add the import `import { ScoreDrawer } from '@/components/evaluation/score-drawer';` and render `{detail?.session?.id && <ScoreDrawer sessionId={detail.session.id} />}` in the page header action area (next to the existing back/copy buttons). Use the actual data variable name for the loaded detail in that file (it is the React Query result; match the existing identifier).

- [ ] **Step 4: Verify** — `bun run dev`, open an inference with a session, click "Score", pick a config, save, and confirm it shows under "Existing session scores" and appears on `/evaluation/scores`. Type-check: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/evaluation "apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx"
git commit -m "feat(evaluation): inline session scoring drawer + add-to-dataset"
```

---

### Task 16: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the shared unit suite**

Run: `nx test shared`
Expected: PASS, including the four new service test files, the evaluation schema tests, and the updated permissions tests.

- [ ] **Step 2: Type-check the whole app**

Run: `bunx tsc --noEmit -p apps/web-ui/tsconfig.json && bunx tsc --noEmit -p libs/shared/tsconfig.lib.json`
Expected: no errors.

- [ ] **Step 3: Build web-ui** (catches App Router route issues)

Run: `nx build web-ui`
Expected: build succeeds; the new `/evaluation/*` and `/api/evaluation/*` and `/api/v1/scores` routes are listed.

- [ ] **Step 4: Manual smoke** — `bun run dev`: create a score config → score a session from `/inferences/[id]` → see it on `/evaluation/scores` → create a dataset → add an item and "Add to dataset" from a trace. Then test ingestion: create an API key with `scores:write`, `curl -X POST .../api/v1/scores` with a valid config + session, expect `201`; repeat without the scope, expect `403`.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(evaluation): verification pass" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Scores config-driven NUMERIC/CATEGORICAL/BOOLEAN → Tasks 1, 3, 4, 5. ✓
- Scores attach to message + session traces → Task 1 (FKs), Task 5 (`assertTargetInTenant`, target columns). ✓
- Manual dashboard scoring + ingestion API → Tasks 9, 11, 15. ✓
- Datasets CRUD + items (manual, from-trace, bulk import) → Tasks 1, 6, 7, 10, 14. ✓
- RBAC `Evaluation` module + `scores:write` scope → Tasks 2, 11. ✓
- Navigation + inline scoring on inference detail → Tasks 12, 15. ✓
- Independence from MessageFeedback/CSAT → no task touches them. ✓
- Out-of-scope items (experiments, annotation queues, evaluators, dataset-item scoring) → not implemented, by design. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — each step carries full code. CSV import explicitly narrowed to JSON-array import with a documented note (Task 14). ✓

**Type consistency:** Service class names, method signatures, and input-type names are defined in their producing task's Interfaces block and reused verbatim downstream (`ScoreConfigService.archive`, `ScoreService.createManual/ingest/listByTenant/delete`, `DatasetService`, `DatasetItemService.addFromTrace/bulkCreate`). Score value resolution (`numericValue`/`stringValue`) consistent between schema, service, routes, and UI. `targetType` values `MESSAGE`/`SESSION` consistent throughout. ✓

**Assumptions to verify during execution (noted inline):** (a) shadcn `tabs`/`sheet`/`table`/`dialog` components exist — Tasks 13/15 add them if absent; (b) the inference detail page's loaded-data identifier — Task 15 Step 3 says match the existing variable name. (`createLogger`, `getSessionUserId`, `getSessionTenantId`, `getPrismaClient`, `authorize` are confirmed already exported from `@chatbot/shared`.)
