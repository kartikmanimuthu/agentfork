# Implementation Plan — Evaluation Module Phase Two

> **Agentic execution note:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this task-by-task. Each task uses checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-19  
**Goal:** Extend the existing Evaluation module with three surfaces: Evaluators (LLM-as-judge configs that produce `Score` rows), Human Annotation (review queues that route unscored targets to reviewers), and Experiments (dataset runs comparing agent versions).

**Architecture:** Keep the already-shipped slice untouched. Add Prisma models, shared services, API routes, pg-boss worker jobs, and dashboard pages following the established class-service + injected Prisma + Pino logging pattern. Re-use `ScoreConfig`, `Score`, `Dataset`, `DatasetItem`, `AgentVersion`, and `InferenceSession` models. Evaluators and annotation queues are soft-deleted via `isActive=false`; experiments and run items are hard-deleted.

**Tech Stack:** Bun, Nx, Next.js 15, Prisma, PostgreSQL, pg-boss, Pino, shadcn/ui, React Query, Zod, `@chatbot/ai`, `@chatbot/agent-studio/server`.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `prisma/migrations/20260619000000_evaluation_phase_two/migration.sql` | Phase-two schema migration |
| `libs/shared/src/services/evaluator-service.ts` | Evaluator CRUD |
| `libs/shared/src/services/evaluator-runner-service.ts` | LLM-as-judge execution; writes `Score` rows |
| `libs/shared/src/services/annotation-queue-service.ts` | Queue CRUD + populate |
| `libs/shared/src/services/annotation-queue-item-service.ts` | Queue item lifecycle + review submission |
| `libs/shared/src/services/experiment-service.ts` | Experiment CRUD + start |
| `libs/shared/src/services/experiment-runner-service.ts` | Iterates dataset items × agent versions |
| `libs/shared/src/services/experiment-inference-service.ts` | Lightweight single-turn inference helper |
| `libs/shared/src/validation/schemas/evaluation.ts` (extended) | Zod schemas for all new surfaces |
| `libs/shared/src/services/evaluator-service.test.ts` | Evaluator service unit tests |
| `libs/shared/src/services/evaluator-runner-service.test.ts` | Evaluator runner unit tests |
| `libs/shared/src/services/annotation-queue-service.test.ts` | Queue service unit tests |
| `libs/shared/src/services/annotation-queue-item-service.test.ts` | Queue item service unit tests |
| `libs/shared/src/services/experiment-service.test.ts` | Experiment service unit tests |
| `apps/workers/src/jobs/evaluator-run/schema.ts` | pg-boss job payload schema |
| `apps/workers/src/jobs/evaluator-run/handler.ts` | Evaluator run worker handler |
| `apps/workers/src/jobs/evaluator-run/register.ts` | Job registration |
| `apps/workers/src/jobs/experiment-run/schema.ts` | pg-boss job payload schema |
| `apps/workers/src/jobs/experiment-run/handler.ts` | Experiment run worker handler |
| `apps/workers/src/jobs/experiment-run/register.ts` | Job registration |
| `apps/web-ui/app/api/evaluation/evaluators/route.ts` | Evaluator list/create |
| `apps/web-ui/app/api/evaluation/evaluators/[id]/route.ts` | Evaluator get/update/disable |
| `apps/web-ui/app/api/evaluation/evaluators/[id]/run/route.ts` | Enqueue evaluator run |
| `apps/web-ui/app/api/evaluation/annotation-queues/route.ts` | Queue list/create |
| `apps/web-ui/app/api/evaluation/annotation-queues/[id]/route.ts` | Queue get/update/disable/populate |
| `apps/web-ui/app/api/evaluation/annotation-queues/[id]/items/route.ts` | Queue items |
| `apps/web-ui/app/api/evaluation/annotation-queues/[id]/items/[itemId]/route.ts` | Review/submit/skip item |
| `apps/web-ui/app/api/evaluation/experiments/route.ts` | Experiment list/create |
| `apps/web-ui/app/api/evaluation/experiments/[id]/route.ts` | Experiment get/delete |
| `apps/web-ui/app/api/evaluation/experiments/[id]/run/route.ts` | Enqueue experiment run |
| `apps/web-ui/app/(dashboard)/evaluation/evaluators/page.tsx` | Evaluators list + dialog |
| `apps/web-ui/components/evaluation/evaluator-dialog.tsx` | Evaluator create/edit dialog |
| `apps/web-ui/app/(dashboard)/evaluation/annotation-queues/page.tsx` | Annotation queues list |
| `apps/web-ui/app/(dashboard)/evaluation/annotation-queues/[id]/page.tsx` | Queue review page |
| `apps/web-ui/app/(dashboard)/evaluation/experiments/page.tsx` | Experiments list |
| `apps/web-ui/app/(dashboard)/evaluation/experiments/[id]/page.tsx` | Experiment detail |

### Modified Files

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Add `Evaluator`, `AnnotationQueue`, `AnnotationQueueItem`, `Experiment`, `ExperimentRunItem`; update relations on `Tenant`, `ScoreConfig`, `Dataset`, `DatasetItem`, `AgentVersion`, `InferenceSession` |
| `libs/shared/src/index.ts` | Export new services, types, and schemas |
| `libs/shared/src/rbac/types.ts` | Add `Evaluator`, `AnnotationQueue`, `AnnotationQueueItem`, `Experiment`, `ExperimentRunItem` to `SUBJECT_TO_MODULE` |
| `libs/shared/src/client.ts` | Re-export new validation schemas |
| `apps/workers/src/index.ts` | Register `evaluator-run` and `experiment-run` jobs |
| `apps/workers/src/job-runner.ts` | Add handlers to the standalone runner list |
| `apps/web-ui/components/layout/app-sidebar.tsx` | Add Evaluators, Annotation Queues, Experiments to `evaluationNav` |
| `apps/web-ui/app/api/evaluation/datasets/lib/errors.ts` (or new sibling) | Re-use `evalError` for new routes |

---

## Global Constraints

Copied from project standards and the existing Evaluation slice:

1. **TypeScript strict mode** (`strict: true` in `tsconfig.base.json`). Every service interface is explicit; `any` is avoided except at Prisma JSON boundaries with a comment.
2. **Class-based services** with injected Prisma client and Pino logger. No static state. Services import `createLogger` from `@chatbot/shared`.
3. **Zod validation** for all request bodies and query params. Schemas live in `libs/shared/src/validation/schemas/evaluation.ts` and are re-exported from `@chatbot/shared` and `@chatbot/shared/client`.
4. **Prisma conventions:** all models use `@id @default(cuid())`, `createdAt`/`updatedAt`, `@@map("snake_case")`, and indexes on `tenantId` and foreign keys.
5. **RBAC:** all API routes call `authorize(action, Subject, authOptions)`. New subjects are mapped to the existing `Evaluation` module in `SUBJECT_TO_MODULE`; no new module needed.
6. **Pino logging:** every service operation logs start/success/failure with structured context (`tenantId`, resource ids, counts).
7. **shadcn/ui + React Query** for dashboard pages. Tables use the existing `DataTable` component. Mutations invalidate the matching query keys.
8. **Soft vs hard deletion:** Evaluators and annotation queues disable via `isActive=false`. Experiments and experiment run items hard-delete (cascade from `Experiment`).
9. **Workers use pg-boss** with a `schema.ts`, `handler.ts`, and `register.ts` triplet. Handlers import `getPrismaClient` from `@chatbot/shared/workers`.
10. **No Prisma enum changes** for string enums (`Score.source`, `Experiment.status`, etc.).

---

## Task 1: Prisma schema changes

**Files:**
- Modify: `prisma/schema.prisma`
- Create migration: `prisma/migrations/20260619000000_evaluation_phase_two/migration.sql`

### Interfaces

**Consumes:** existing `Tenant`, `ScoreConfig`, `Dataset`, `DatasetItem`, `AgentVersion`, `InferenceSession`, `InferenceSessionMessage`, `ApiKeyExecution` models.  
**Produces:** new Prisma models and relations.

### Steps

- [ ] **Step 1: Add `Evaluator` model**

```prisma
model Evaluator {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  scoreConfigId String
  prompt      String   @db.Text
  model       String?
  temperature Float?   @default(0.7)
  maxTokens   Int?     @default(4096)
  isActive    Boolean  @default(true)
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  scoreConfig ScoreConfig @relation(fields: [scoreConfigId], references: [id], onDelete: Restrict)

  @@unique([tenantId, name])
  @@index([tenantId])
  @@index([tenantId, isActive])
  @@index([scoreConfigId])
  @@map("evaluators")
}
```

- [ ] **Step 2: Add `AnnotationQueue` model**

```prisma
model AnnotationQueue {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  scoreConfigId String
  targetType  String   // MESSAGE | SESSION | EXECUTION
  filters     Json?    // { sessionIds?, messageIds?, executionIds?, dateRange?, source? }
  isActive    Boolean  @default(true)
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  scoreConfig ScoreConfig @relation(fields: [scoreConfigId], references: [id], onDelete: Restrict)
  items       AnnotationQueueItem[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@index([tenantId, isActive])
  @@index([scoreConfigId])
  @@map("annotation_queues")
}
```

- [ ] **Step 3: Add `AnnotationQueueItem` model**

```prisma
model AnnotationQueueItem {
  id             String   @id @default(cuid())
  queueId        String
  tenantId       String
  targetType     String   // MESSAGE | SESSION | EXECUTION
  messageId      String?
  sessionId      String?
  executionId    String?
  status         String   @default("PENDING") // PENDING | REVIEWED | SKIPPED
  reviewerUserId String?
  scoreId        String?
  comment        String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  queue     AnnotationQueue        @relation(fields: [queueId], references: [id], onDelete: Cascade)
  tenant    Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  message   InferenceSessionMessage? @relation(fields: [messageId], references: [id], onDelete: SetNull)
  session   InferenceSession?        @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  execution ApiKeyExecution?         @relation(fields: [executionId], references: [id], onDelete: SetNull)

  @@index([queueId])
  @@index([queueId, status])
  @@index([tenantId])
  @@index([messageId])
  @@index([sessionId])
  @@index([executionId])
  @@map("annotation_queue_items")
}
```

- [ ] **Step 4: Add `Experiment` and `ExperimentRunItem` models**

```prisma
model Experiment {
  id              String   @id @default(cuid())
  tenantId        String
  name            String
  description     String?
  datasetId       String
  agentVersionIds String[]
  scoreConfigIds  String[]
  status          String   @default("DRAFT") // DRAFT | RUNNING | COMPLETED | FAILED
  metadata        Json?
  createdBy       String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant    Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  dataset   Dataset             @relation(fields: [datasetId], references: [id], onDelete: Restrict)
  runItems  ExperimentRunItem[]

  @@index([tenantId])
  @@index([tenantId, status])
  @@index([datasetId])
  @@map("experiments")
}

model ExperimentRunItem {
  id                 String   @id @default(cuid())
  experimentId       String
  tenantId           String
  datasetItemId      String
  agentVersionId     String
  inferenceSessionId String?
  status             String   @default("PENDING") // PENDING | RUNNING | COMPLETED | FAILED
  outputText         String?  @db.Text
  outputJson         Json?
  latencyMs          Int?
  tokenUsage         Json?
  error              String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  experiment   Experiment          @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  tenant       Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  datasetItem  DatasetItem         @relation(fields: [datasetItemId], references: [id], onDelete: Cascade)
  agentVersion AgentVersion        @relation(fields: [agentVersionId], references: [id], onDelete: Cascade)
  session      InferenceSession?   @relation(fields: [inferenceSessionId], references: [id], onDelete: SetNull)

  @@index([experimentId])
  @@index([experimentId, datasetItemId])
  @@index([experimentId, agentVersionId])
  @@index([tenantId])
  @@map("experiment_run_items")
}
```

- [ ] **Step 5: Add back-relations to existing models**

Update the relation blocks (do not duplicate full models):

```prisma
model Tenant {
  // ... existing fields ...
  evaluators           Evaluator[]
  annotationQueues     AnnotationQueue[]
  annotationQueueItems AnnotationQueueItem[]
  experiments          Experiment[]
  experimentRunItems   ExperimentRunItem[]
}

model ScoreConfig {
  // ...
  evaluators       Evaluator[]
  annotationQueues AnnotationQueue[]
}

model Dataset {
  // ...
  experiments      Experiment[]
}

model DatasetItem {
  // ...
  experimentRunItems ExperimentRunItem[]
}

model AgentVersion {
  // ...
  experimentRunItems ExperimentRunItem[]
}

model InferenceSession {
  // ...
  experimentRunItems ExperimentRunItem[]
}
```

- [ ] **Step 6: Generate and apply migration**

```bash
bunx prisma migrate dev --name evaluation_phase_two --schema=./prisma/schema.prisma
```

**Verification commands:**

```bash
bunx prisma generate --schema=./prisma/schema.prisma
bunx prisma migrate status --schema=./prisma/schema.prisma
```

Expected output: Prisma client generated successfully; migration `20260619000000_evaluation_phase_two` is present and applied.

---

## Task 2: Extend validation schemas

**Files:**
- Modify: `libs/shared/src/validation/schemas/evaluation.ts`

### Interfaces

**Consumes:** existing `scoreDataTypeSchema`, `scoreTargetTypeSchema`, `scoreCategorySchema`.  
**Produces:** Zod schemas for evaluators, queues, queue items, experiments, run items, and runner payloads.

### Steps

- [ ] **Step 1: Append new schemas**

```typescript
// ── Evaluator ──────────────────────────────────────────────────────────────
export const evaluatorCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scoreConfigId: z.string().min(1),
  prompt: z.string().min(1).max(20000),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const evaluatorUpdateSchema = evaluatorCreateSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

// ── Annotation Queue ─────────────────────────────────────────────────────────
export const annotationQueueCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scoreConfigId: z.string().min(1),
  targetType: scoreTargetTypeSchema,
  filters: z.object({
    sessionIds: z.array(z.string()).optional(),
    messageIds: z.array(z.string()).optional(),
    executionIds: z.array(z.string()).optional(),
    dateRange: z.object({ from: isoDateSchema, to: isoDateSchema }).optional(),
  }).optional(),
});

export const annotationQueueUpdateSchema = annotationQueueCreateSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const annotationQueuePopulateSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const annotationQueueItemReviewSchema = z.object({
  value: scoreValueSchema,
  comment: z.string().max(1000).optional(),
  status: z.enum(['REVIEWED', 'SKIPPED']).default('REVIEWED'),
});

// ── Experiment ───────────────────────────────────────────────────────────────
export const experimentCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  datasetId: z.string().min(1),
  agentVersionIds: z.array(z.string().min(1)).min(1),
  scoreConfigIds: z.array(z.string().min(1)).min(1),
  metadata: z.unknown().optional(),
});

export const experimentUpdateSchema = experimentCreateSchema.partial();

export const experimentRunPayloadSchema = z.object({
  experimentId: z.string().min(1),
  tenantId: z.string().min(1),
});

export const evaluatorRunPayloadSchema = z.object({
  evaluatorId: z.string().min(1),
  tenantId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});
```

- [ ] **Step 2: Export inferred types**

```typescript
export type EvaluatorCreate = z.infer<typeof evaluatorCreateSchema>;
export type EvaluatorUpdate = z.infer<typeof evaluatorUpdateSchema>;
export type AnnotationQueueCreate = z.infer<typeof annotationQueueCreateSchema>;
export type AnnotationQueueUpdate = z.infer<typeof annotationQueueUpdateSchema>;
export type AnnotationQueueItemReview = z.infer<typeof annotationQueueItemReviewSchema>;
export type ExperimentCreate = z.infer<typeof experimentCreateSchema>;
export type ExperimentUpdate = z.infer<typeof experimentUpdateSchema>;
```

**Verification command:**

```bash
nx test shared -- evaluation.test
```

Expected output: schema tests pass; new inferred types are available from `@chatbot/shared`.

---

## Task 3: EvaluatorService + EvaluatorRunnerService

**Files:**
- Create: `libs/shared/src/services/evaluator-service.ts`
- Create: `libs/shared/src/services/evaluator-runner-service.ts`
- Create tests: `libs/shared/src/services/evaluator-service.test.ts`, `libs/shared/src/services/evaluator-runner-service.test.ts`

### Interfaces

**Consumes:** `PrismaClient` shape, `ScoreConfigService` types, `ScoreService` types, `@chatbot/ai` provider, `Score` model.  
**Produces:** `EvaluatorService` (CRUD + disable), `EvaluatorRunnerService` (run LLM-as-judge and persist `Score` rows with `source='EVALUATOR'`).

### Steps

- [ ] **Step 1: Write `EvaluatorService`**

```typescript
import { createLogger } from '../logging/logger';
import type { ScoreDataType } from './score-config-service';

const logger = createLogger('evaluator-service');

export interface CreateEvaluatorInput {
  tenantId: string;
  name: string;
  description?: string;
  scoreConfigId: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  createdBy: string;
}

export interface UpdateEvaluatorInput {
  name?: string;
  description?: string;
  scoreConfigId?: string;
  prompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  isActive?: boolean;
}

export interface EvaluatorDb {
  evaluator: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  scoreConfig: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string; dataType: ScoreDataType } | null> };
}

export class EvaluatorService {
  constructor(private readonly db: EvaluatorDb) {}

  async create(input: CreateEvaluatorInput): Promise<unknown> {
    try {
      await this.requireScoreConfigInTenant(input.tenantId, input.scoreConfigId);
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating evaluator');
      return await this.db.evaluator.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          scoreConfigId: input.scoreConfigId,
          prompt: input.prompt,
          model: input.model ?? null,
          temperature: input.temperature ?? null,
          maxTokens: input.maxTokens ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create evaluator');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.evaluator.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list evaluators');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.evaluator.findFirst({
        where: { id, tenantId },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true, categories: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get evaluator');
      throw error;
    }
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const existing = await this.db.evaluator.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Evaluator not found');
  }

  private async requireScoreConfigInTenant(tenantId: string, scoreConfigId: string): Promise<void> {
    const config = await this.db.scoreConfig.findFirst({ where: { id: scoreConfigId, tenantId } });
    if (!config) throw new Error('Score config not found');
  }

  async update(tenantId: string, id: string, patch: UpdateEvaluatorInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      if (patch.scoreConfigId) await this.requireScoreConfigInTenant(tenantId, patch.scoreConfigId);
      logger.info({ tenantId, id }, 'Updating evaluator');
      return await this.db.evaluator.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update evaluator');
      throw error;
    }
  }

  async disable(tenantId: string, id: string): Promise<unknown> {
    return this.update(tenantId, id, { isActive: false });
  }
}
```

- [ ] **Step 2: Write `EvaluatorRunnerService`**

The runner loads the evaluator + its score config, resolves target content, calls an LLM with a JSON instruction, parses the result, and creates a `Score` via `ScoreService`.

```typescript
import { createLogger } from '../logging/logger';
import type { LLMProvider } from '@chatbot/ai';
import { streamChat } from '@chatbot/ai';
import { ScoreService, type ScoreDb, type ScoreTargetType } from './score-service';
import type { ScoreDataType } from './score-config-service';

const logger = createLogger('evaluator-runner-service');

export interface EvaluatorRunnerDb extends ScoreDb {
  evaluator: {
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<EvaluatorRow | null>;
  };
  inferenceSessionMessage: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<MessageTarget | null> };
  inferenceSession: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<SessionTarget | null> };
  apiKeyExecution: { findFirst(args: { where: Record<string, unknown> }): Promise<ExecutionTarget | null> };
}

interface EvaluatorRow {
  id: string;
  tenantId: string;
  name: string;
  prompt: string;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  scoreConfig: { id: string; dataType: ScoreDataType; categories: unknown };
}

interface MessageTarget { id: string; role: string; content: string; session: { tenantId: string } }
interface SessionTarget { id: string; tenantId: string; messages?: Array<{ role: string; content: string }> }
interface ExecutionTarget { id: string; tenantId: string; input: unknown; output: unknown }

export interface RunEvaluatorInput {
  tenantId: string;
  evaluatorId: string;
  provider: LLMProvider;
  targetType: ScoreTargetType;
  targetId: string;
}

export class EvaluatorRunnerService {
  private readonly scoreService: ScoreService;

  constructor(private readonly db: EvaluatorRunnerDb) {
    this.scoreService = new ScoreService(db);
  }

  private async loadEvaluator(tenantId: string, evaluatorId: string): Promise<EvaluatorRow> {
    const evaluator = await this.db.evaluator.findFirst({
      where: { id: evaluatorId, tenantId, isActive: true },
      include: { scoreConfig: { select: { id: true, dataType: true, categories: true } } },
    }) as EvaluatorRow | null;
    if (!evaluator) throw new Error('Evaluator not found or inactive');
    return evaluator;
  }

  private async resolveTargetContent(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<string> {
    if (targetType === 'MESSAGE') {
      const msg = await this.db.inferenceSessionMessage.findFirst({
        where: { id: targetId },
        include: { session: { select: { tenantId: true } } },
      });
      if (!msg || msg.session.tenantId !== tenantId) throw new Error('Target message not found');
      return `Role: ${msg.role}\nContent: ${msg.content}`;
    }
    if (targetType === 'SESSION') {
      const session = await this.db.inferenceSession.findFirst({
        where: { id: targetId, tenantId },
        include: { messages: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true } } },
      });
      if (!session) throw new Error('Target session not found');
      return (session.messages ?? []).map((m) => `${m.role}: ${m.content}`).join('\n');
    }
    const execution = await this.db.apiKeyExecution.findFirst({ where: { id: targetId, tenantId } });
    if (!execution) throw new Error('Target execution not found');
    return `Input:\n${JSON.stringify(execution.input, null, 2)}\n\nOutput:\n${JSON.stringify(execution.output, null, 2)}`;
  }

  private buildJsonInstruction(dataType: ScoreDataType): string {
    if (dataType === 'NUMERIC') return 'Respond with JSON: {"score": number, "reason": string}';
    if (dataType === 'CATEGORICAL') return 'Respond with JSON: {"label": string, "reason": string}';
    return 'Respond with JSON: {"passed": boolean, "reason": string}';
  }

  private parseResult(dataType: ScoreDataType, text: string): { value: string | number | boolean; reason?: string } {
    const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    if (dataType === 'NUMERIC') return { value: Number(parsed.score), reason: parsed.reason };
    if (dataType === 'CATEGORICAL') return { value: String(parsed.label), reason: parsed.reason };
    return { value: Boolean(parsed.passed), reason: parsed.reason };
  }

  async run(input: RunEvaluatorInput): Promise<unknown> {
    try {
      const evaluator = await this.loadEvaluator(input.tenantId, input.evaluatorId);
      const targetContent = await this.resolveTargetContent(input.tenantId, input.targetType, input.targetId);
      const instruction = this.buildJsonInstruction(evaluator.scoreConfig.dataType);
      const fullPrompt = `${evaluator.prompt}\n\n---\n${instruction}\n\nTarget:\n${targetContent}`;

      logger.info({ tenantId: input.tenantId, evaluatorId: evaluator.id, targetType: input.targetType }, 'Running evaluator');

      const result = streamChat({
        provider: input.provider,
        model: evaluator.model ?? undefined,
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: evaluator.temperature ?? 0.7,
        maxOutputTokens: evaluator.maxTokens ?? 4096,
      });

      const text = await result.text;
      const { value, reason } = this.parseResult(evaluator.scoreConfig.dataType, text);

      return await this.scoreService.ingest({
        tenantId: input.tenantId,
        configId: evaluator.scoreConfig.id,
        targetType: input.targetType,
        targetId: input.targetId,
        value,
        comment: reason ? `Evaluator: ${evaluator.name}. ${reason}` : `Evaluator: ${evaluator.name}`,
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, evaluatorId: input.evaluatorId }, 'Failed to run evaluator');
      throw error;
    }
  }
}
```

Note: `ScoreService.ingest` currently writes `source: 'API'`. Update it to accept an optional `source` override defaulting to `'API'` so the runner can pass `'EVALUATOR'`.

- [ ] **Step 3: Update `ScoreService.ingest` signature**

```typescript
export interface IngestScoreInput {
  tenantId: string;
  configId: string;
  targetType: ScoreTargetType;
  targetId: string;
  value: ScoreValue;
  comment?: string;
  source?: 'ANNOTATION' | 'API' | 'EVALUATOR';
}
```

Inside `ingest`, use `source: input.source ?? 'API'`.

**Verification commands:**

```bash
nx test shared -- evaluator-service
nx test shared -- evaluator-runner-service
```

Expected output: all new unit tests pass; `ScoreService` tests still pass.

---

## Task 4: Evaluator API routes + worker job

**Files:**
- Create: `apps/web-ui/app/api/evaluation/evaluators/route.ts`
- Create: `apps/web-ui/app/api/evaluation/evaluators/[id]/route.ts`
- Create: `apps/web-ui/app/api/evaluation/evaluators/[id]/run/route.ts`
- Create: `apps/workers/src/jobs/evaluator-run/schema.ts`
- Create: `apps/workers/src/jobs/evaluator-run/handler.ts`
- Create: `apps/workers/src/jobs/evaluator-run/register.ts`
- Modify: `apps/workers/src/index.ts`, `apps/workers/src/job-runner.ts`

### Interfaces

**Consumes:** `EvaluatorService`, `EvaluatorRunnerService`, `LlmProviderService`, `@chatbot/ai` `createLLMProvider`, `authorize`, `getSessionTenantId`, `getSessionUserId`, `getPrismaClient`, `pg-boss`.

### Steps

- [ ] **Step 1: Write evaluator list/create route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, EvaluatorService, createLogger } from '@chatbot/shared';
import { evaluatorCreateSchema, parseJson } from '@chatbot/shared';
import type { EvaluatorDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../datasets/lib/errors';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:evaluators');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Evaluator', authOptions);
    if (authError) return authError;
    const evaluators = await new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb).list(tenantId);
    return NextResponse.json({ evaluators });
  } catch (error) { return evalError(error, logger, 'list evaluators'); }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Evaluator', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, evaluatorCreateSchema);
    const evaluator = await new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb).create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ evaluator }, { status: 201 });
  } catch (error) { return evalError(error, logger, 'create evaluator'); }
}
```

- [ ] **Step 2: Write evaluator detail/update/disable route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, EvaluatorService, createLogger } from '@chatbot/shared';
import { evaluatorUpdateSchema, parseJson } from '@chatbot/shared';
import type { EvaluatorDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../../datasets/lib/errors';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:evaluators:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Evaluator', authOptions);
    if (authError) return authError;
    const evaluator = await new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb).get(tenantId, id);
    if (!evaluator) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ evaluator });
  } catch (error) { return evalError(error, logger, 'get evaluator'); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Evaluator', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, evaluatorUpdateSchema);
    const evaluator = await new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb).update(tenantId, id, body);
    return NextResponse.json({ evaluator });
  } catch (error) { return evalError(error, logger, 'update evaluator'); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Evaluator', authOptions);
    if (authError) return authError;
    await new EvaluatorService(getPrismaClient() as unknown as EvaluatorDb).disable(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return evalError(error, logger, 'disable evaluator'); }
}
```

- [ ] **Step 3: Write evaluator run enqueue route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { evalError } from '../../../datasets/lib/errors';
import type PgBoss from 'pg-boss';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:evaluators:run');
const JOB_NAME = 'evaluator-run';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Evaluator', authOptions);
    if (authError) return authError;
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') ?? 100);
    const boss: PgBoss = (globalThis as any).__pgBoss__;
    if (!boss) throw new Error('pg-boss not initialized');
    const jobId = await boss.send(JOB_NAME, { evaluatorId: id, tenantId, limit });
    logger.info({ tenantId, evaluatorId: id, jobId }, 'Enqueued evaluator run');
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) { return evalError(error, logger, 'enqueue evaluator run'); }
}
```

- [ ] **Step 4: Write worker job files**

`apps/workers/src/jobs/evaluator-run/schema.ts`:

```typescript
import { z } from 'zod';

export const evaluatorRunJobSchema = z.object({
  evaluatorId: z.string().min(1),
  tenantId: z.string().min(1),
  limit: z.number().int().min(1).max(1000).default(100),
});

export type EvaluatorRunJobData = z.infer<typeof evaluatorRunJobSchema>;
```

`apps/workers/src/jobs/evaluator-run/handler.ts`:

```typescript
import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { EvaluatorRunnerService, LlmProviderService, createLogger } from '@chatbot/shared/workers';
import { createLLMProvider } from '@chatbot/ai';
import { evaluatorRunJobSchema } from './schema.js';

const log = createLogger('evaluator-run');

export async function handleEvaluatorRun(data: unknown, _boss?: PgBoss): Promise<void> {
  const { evaluatorId, tenantId, limit } = evaluatorRunJobSchema.parse(data);
  log.info({ evaluatorId, tenantId }, 'Starting evaluator run');

  const db = getPrismaClient();
  const runner = new EvaluatorRunnerService(db as any);
  const llmService = new LlmProviderService(tenantId);
  const config = await llmService.getDefaultConfig();
  const provider = createLLMProvider(config);

  // Fetch up to `limit` targets that lack a score for this evaluator's config.
  // For v1, target candidates are the most recent messages in the tenant.
  const targets = await db.inferenceSessionMessage.findMany({
    where: { session: { tenantId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      await runner.run({ tenantId, evaluatorId, provider, targetType: 'MESSAGE', targetId: target.id });
      processed++;
    } catch (err) {
      failed++;
      log.error({ err, targetId: target.id }, 'Evaluator target failed');
    }
  }
  log.info({ evaluatorId, tenantId, processed, failed }, 'Evaluator run complete');
}
```

`apps/workers/src/jobs/evaluator-run/register.ts`:

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleEvaluatorRun } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('evaluator-run-register');
const JOB_NAME = 'evaluator-run';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) executor.registerHandler(JOB_NAME, (data) => handleEvaluatorRun(data));
  await boss.createQueue(JOB_NAME);
  await boss.work(JOB_NAME, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      log.info({ jobId: job.id }, 'Processing evaluator run job');
      await executor.execute(JOB_NAME, job.data);
    }
  });
  log.info({ jobName: JOB_NAME }, 'Registered evaluator run job');
}
```

- [ ] **Step 5: Register in `apps/workers/src/index.ts`**

```typescript
import { register as registerEvaluatorRun } from './jobs/evaluator-run/register.js';
import { register as registerExperimentRun } from './jobs/experiment-run/register.js';
// ...
await registerEvaluatorRun(boss, executor);
await registerExperimentRun(boss, executor);
```

- [ ] **Step 6: Add to `apps/workers/src/job-runner.ts`**

Add `evaluator-run` and `experiment-run` to `knownJobs`.

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/workers/tsconfig.json
nx test workers -- evaluator-run
```

Expected output: worker TypeScript compiles; handler unit tests pass.

---

## Task 5: Evaluator UI page + dialog

**Files:**
- Create: `apps/web-ui/app/(dashboard)/evaluation/evaluators/page.tsx`
- Create: `apps/web-ui/components/evaluation/evaluator-dialog.tsx`

### Interfaces

**Consumes:** `GET/POST /api/evaluation/evaluators`, `PATCH/DELETE /api/evaluation/evaluators/[id]`, `POST /api/evaluation/evaluators/[id]/run`, `GET /api/evaluation/score-configs`, React Query, shadcn DataTable.

### Steps

- [ ] **Step 1: Build `EvaluatorDialog`**

Structure:
- Name input
- Description input
- Score config Select (fetch `GET /api/evaluation/score-configs`)
- Prompt Textarea (placeholder includes `{target}`)
- Model input (optional; fallback to tenant default)
- Temperature + maxTokens inputs
- Save mutation posts to `POST` or `PATCH /api/evaluation/evaluators/:id`
- On success: invalidate `['eval-evaluators']` and close

- [ ] **Step 2: Build `EvaluatorsPage`**

Columns:
- Name + description
- Linked score config name
- Model/temperature badge
- `isActive` badge
- Actions: Edit, Disable (sets `isActive=false`), Run

Add a "Run" button that posts to `/api/evaluation/evaluators/[id]/run?limit=100` and shows toast "Evaluator run queued".

Use `DataTable` with `queryKey: ['eval-evaluators']`.

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
nx build web-ui
```

Expected output: page builds without TypeScript errors.

---

## Task 6: AnnotationQueueService + AnnotationQueueItemService

**Files:**
- Create: `libs/shared/src/services/annotation-queue-service.ts`
- Create: `libs/shared/src/services/annotation-queue-item-service.ts`
- Create tests for both

### Interfaces

**Consumes:** `PrismaClient`, `ScoreConfig` model, target models (`InferenceSessionMessage`, `InferenceSession`, `ApiKeyExecution`), `ScoreService` for review submissions.  
**Produces:** Queue CRUD, populate logic, item listing/review/skip.

### Steps

- [ ] **Step 1: Write `AnnotationQueueService`**

```typescript
import { createLogger } from '../logging/logger';
import type { ScoreTargetType } from './score-service';

const logger = createLogger('annotation-queue-service');

export interface CreateAnnotationQueueInput {
  tenantId: string;
  name: string;
  description?: string;
  scoreConfigId: string;
  targetType: ScoreTargetType;
  filters?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateAnnotationQueueInput {
  name?: string;
  description?: string;
  scoreConfigId?: string;
  targetType?: ScoreTargetType;
  filters?: Record<string, unknown>;
  isActive?: boolean;
}

export interface AnnotationQueueDb {
  annotationQueue: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  scoreConfig: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
}

export class AnnotationQueueService {
  constructor(private readonly db: AnnotationQueueDb) {}

  private async requireScoreConfig(tenantId: string, scoreConfigId: string): Promise<void> {
    const cfg = await this.db.scoreConfig.findFirst({ where: { id: scoreConfigId, tenantId } });
    if (!cfg) throw new Error('Score config not found');
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const q = await this.db.annotationQueue.findFirst({ where: { id, tenantId } });
    if (!q) throw new Error('Queue not found');
  }

  async create(input: CreateAnnotationQueueInput): Promise<unknown> {
    try {
      await this.requireScoreConfig(input.tenantId, input.scoreConfigId);
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating annotation queue');
      return await this.db.annotationQueue.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          scoreConfigId: input.scoreConfigId,
          targetType: input.targetType,
          filters: input.filters ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create annotation queue');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.annotationQueue.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true } }, _count: { select: { items: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list annotation queues');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.annotationQueue.findFirst({
        where: { id, tenantId },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true, categories: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get annotation queue');
      throw error;
    }
  }

  async update(tenantId: string, id: string, patch: UpdateAnnotationQueueInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      if (patch.scoreConfigId) await this.requireScoreConfig(tenantId, patch.scoreConfigId);
      logger.info({ tenantId, id }, 'Updating annotation queue');
      return await this.db.annotationQueue.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update annotation queue');
      throw error;
    }
  }

  async disable(tenantId: string, id: string): Promise<unknown> {
    return this.update(tenantId, id, { isActive: false });
  }
}
```

- [ ] **Step 2: Write `AnnotationQueueItemService`**

```typescript
import { createLogger } from '../logging/logger';
import { ScoreService, type ScoreDb, type ScoreTargetType } from './score-service';

const logger = createLogger('annotation-queue-item-service');

export interface AnnotationQueueItemDb extends ScoreDb {
  annotationQueue: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<QueueRow | null> };
  annotationQueueItem: {
    createMany(args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown; take?: number; skip?: number }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  inferenceSessionMessage: { findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; select?: unknown }): Promise<Array<{ id: string; session: { tenantId: string } }>> };
  inferenceSession: { findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; select?: unknown }): Promise<Array<{ id: string; tenantId: string }>> };
  apiKeyExecution: { findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; select?: unknown }): Promise<Array<{ id: string; tenantId: string }>> };
  score: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null> };
}

interface QueueRow {
  id: string;
  tenantId: string;
  scoreConfigId: string;
  targetType: ScoreTargetType;
  filters?: { sessionIds?: string[]; messageIds?: string[]; executionIds?: string[]; dateRange?: { from?: string; to?: string } } | null;
}

export interface ReviewQueueItemInput {
  tenantId: string;
  queueId: string;
  itemId: string;
  reviewerUserId: string;
  value: string | number | boolean;
  comment?: string;
  status?: 'REVIEWED' | 'SKIPPED';
}

export class AnnotationQueueItemService {
  private readonly scoreService: ScoreService;

  constructor(private readonly db: AnnotationQueueItemDb) {
    this.scoreService = new ScoreService(db);
  }

  private async requireQueue(tenantId: string, queueId: string): Promise<QueueRow> {
    const queue = await this.db.annotationQueue.findFirst({
      where: { id: queueId, tenantId },
      include: { scoreConfig: { select: { dataType: true } } },
    }) as QueueRow | null;
    if (!queue) throw new Error('Queue not found');
    return queue;
  }

  private targetColumns(targetType: ScoreTargetType, targetId: string) {
    if (targetType === 'MESSAGE') return { messageId: targetId, sessionId: null, executionId: null };
    if (targetType === 'SESSION') return { messageId: null, sessionId: targetId, executionId: null };
    return { messageId: null, sessionId: null, executionId: targetId };
  }

  async populate(tenantId: string, queueId: string, limit: number = 100): Promise<{ count: number }> {
    try {
      const queue = await this.requireQueue(tenantId, queueId);
      const colsPrefix = this.targetColumns(queue.targetType, '');

      const existingWhere: Record<string, unknown> = { queueId, tenantId };
      const targetIds = queue.filters?.messageIds ?? queue.filters?.sessionIds ?? queue.filters?.executionIds;
      let candidates: Array<{ id: string }> = [];
      const take = limit;

      if (queue.targetType === 'MESSAGE') {
        const where: Record<string, unknown> = { session: { tenantId } };
        if (queue.filters?.messageIds?.length) where.id = { in: queue.filters.messageIds };
        if (queue.filters?.dateRange?.from) where.createdAt = { ...(where.createdAt as object || {}), gte: new Date(queue.filters.dateRange.from) };
        candidates = await this.db.inferenceSessionMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true } });
      } else if (queue.targetType === 'SESSION') {
        const where: Record<string, unknown> = { tenantId };
        if (queue.filters?.sessionIds?.length) where.id = { in: queue.filters.sessionIds };
        candidates = await this.db.inferenceSession.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true } });
      } else {
        const where: Record<string, unknown> = { tenantId };
        if (queue.filters?.executionIds?.length) where.id = { in: queue.filters.executionIds };
        candidates = await this.db.apiKeyExecution.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true } });
      }

      const rows: Record<string, unknown>[] = [];
      for (const c of candidates) {
        const hasScore = await this.db.score.findFirst({
          where: { tenantId, configId: queue.scoreConfigId, ...this.targetColumns(queue.targetType, c.id) },
        });
        const alreadyQueued = await this.db.annotationQueueItem.findFirst({
          where: { queueId, tenantId, ...this.targetColumns(queue.targetType, c.id) },
        });
        if (!hasScore && !alreadyQueued) {
          rows.push({ queueId, tenantId, targetType: queue.targetType, ...this.targetColumns(queue.targetType, c.id), status: 'PENDING' });
        }
      }

      if (rows.length === 0) return { count: 0 };
      const result = await this.db.annotationQueueItem.createMany({ data: rows, skipDuplicates: true });
      logger.info({ tenantId, queueId, count: result.count }, 'Populated annotation queue');
      return { count: result.count };
    } catch (error) {
      logger.error({ err: error, tenantId, queueId }, 'Failed to populate annotation queue');
      throw error;
    }
  }

  async list(tenantId: string, queueId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<unknown[]> {
    try {
      await this.requireQueue(tenantId, queueId);
      const where: Record<string, unknown> = { queueId, tenantId };
      if (opts?.status) where.status = opts.status;
      return await this.db.annotationQueueItem.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: opts?.limit ?? 50,
        skip: opts?.offset ?? 0,
        include: { message: { select: { role: true, content: true } }, session: { select: { id: true } }, execution: { select: { id: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, queueId }, 'Failed to list queue items');
      throw error;
    }
  }

  async review(input: ReviewQueueItemInput): Promise<unknown> {
    try {
      const queue = await this.requireQueue(input.tenantId, input.queueId);
      const item = await this.db.annotationQueueItem.findFirst({ where: { id: input.itemId, queueId: input.queueId, tenantId: input.tenantId } });
      if (!item) throw new Error('Queue item not found');

      let scoreId: string | null = null;
      if (input.status !== 'SKIPPED') {
        const score = await this.scoreService.createManual({
          tenantId: input.tenantId,
          configId: queue.scoreConfigId,
          targetType: queue.targetType,
          targetId: '', // resolved below from item columns in real impl
          value: input.value,
          comment: input.comment,
          authorUserId: input.reviewerUserId,
        }) as { id: string };
        scoreId = score.id;
      }

      logger.info({ tenantId: input.tenantId, queueId: input.queueId, itemId: input.itemId }, 'Reviewed annotation queue item');
      return await this.db.annotationQueueItem.update({
        where: { id: input.itemId },
        data: { status: input.status ?? 'REVIEWED', reviewerUserId: input.reviewerUserId, scoreId, comment: input.comment ?? null },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, queueId: input.queueId, itemId: input.itemId }, 'Failed to review queue item');
      throw error;
    }
  }
}
```

Note: in the real implementation, load the full item row to resolve `targetId` before calling `createManual`. The skeleton above omits that detail for brevity.

**Verification commands:**

```bash
nx test shared -- annotation-queue-service
nx test shared -- annotation-queue-item-service
```

---

## Task 7: Annotation Queue API routes

**Files:**
- Create: `apps/web-ui/app/api/evaluation/annotation-queues/route.ts`
- Create: `apps/web-ui/app/api/evaluation/annotation-queues/[id]/route.ts`
- Create: `apps/web-ui/app/api/evaluation/annotation-queues/[id]/populate/route.ts`
- Create: `apps/web-ui/app/api/evaluation/annotation-queues/[id]/items/route.ts`
- Create: `apps/web-ui/app/api/evaluation/annotation-queues/[id]/items/[itemId]/route.ts`

### Interfaces

**Consumes:** `AnnotationQueueService`, `AnnotationQueueItemService`, `authorize`, `getSessionTenantId`, `getSessionUserId`, `getPrismaClient`.

### Steps

- [ ] **Step 1: Implement list/create, get/update/disable routes** following the pattern in Task 4.
- [ ] **Step 2: Implement `POST /api/evaluation/annotation-queues/[id]/populate`**

```typescript
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const { limit } = await parseJson(req, annotationQueuePopulateSchema);
    const result = await new AnnotationQueueItemService(getPrismaClient() as unknown as AnnotationQueueItemDb).populate(tenantId, id, limit);
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return evalError(error, logger, 'populate queue'); }
}
```

- [ ] **Step 3: Implement items list and review routes**

`GET /api/evaluation/annotation-queues/[id]/items` returns `items`.  
`PATCH /api/evaluation/annotation-queues/[id]/items/[itemId]` calls `AnnotationQueueItemService.review`.

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
nx test shared -- annotation-queue
```

---

## Task 8: Human Annotation UI pages

**Files:**
- Create: `apps/web-ui/app/(dashboard)/evaluation/annotation-queues/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/evaluation/annotation-queues/[id]/page.tsx`

### Interfaces

**Consumes:** annotation queue API routes, score config API, React Query, shadcn Select/Textarea/Button, DataTable.

### Steps

- [ ] **Step 1: Build list page**

Table columns:
- Name
- Target type badge
- Linked score config
- Pending / reviewed counts
- Actions: Open review page, Edit, Disable

Add "Populate" button on each row that posts to the populate route.

- [ ] **Step 2: Build review page (`/evaluation/annotation-queues/[id]`)**

- Fetch queue + items
- Render a review card per item:
  - Show target content (message/session/execution summary)
  - Score input based on `scoreConfig.dataType`:
    - NUMERIC: number input with min/max
    - CATEGORICAL: select with categories
    - BOOLEAN: switch
  - Comment textarea
  - "Submit review" button calls `PATCH /api/evaluation/annotation-queues/[id]/items/[itemId]`
  - "Skip" button sends `status: 'SKIPPED'`
- Auto-advance to next pending item on success

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
nx build web-ui
```

---

## Task 9: ExperimentService + ExperimentRunnerService + ExperimentInferenceService

**Files:**
- Create: `libs/shared/src/services/experiment-service.ts`
- Create: `libs/shared/src/services/experiment-runner-service.ts`
- Create: `libs/shared/src/services/experiment-inference-service.ts`
- Create tests

### Interfaces

**Consumes:** `PrismaClient`, `DatasetService`, `AgentVersionService`, `InferenceSessionService`, `@chatbot/ai` `streamChat`, `@chatbot/agent-studio/server` `GraphExecutor`, `LlmProviderService`.  
**Produces:** Experiment CRUD, run orchestration, single-turn inference, run-item persistence.

### Steps

- [ ] **Step 1: Write `ExperimentService`**

```typescript
import { createLogger } from '../logging/logger';

const logger = createLogger('experiment-service');

export interface CreateExperimentInput {
  tenantId: string;
  name: string;
  description?: string;
  datasetId: string;
  agentVersionIds: string[];
  scoreConfigIds: string[];
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateExperimentInput {
  name?: string;
  description?: string;
  datasetId?: string;
  agentVersionIds?: string[];
  scoreConfigIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExperimentDb {
  experiment: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  dataset: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
}

export class ExperimentService {
  constructor(private readonly db: ExperimentDb) {}

  private async requireDataset(tenantId: string, datasetId: string): Promise<void> {
    const ds = await this.db.dataset.findFirst({ where: { id: datasetId, tenantId } });
    if (!ds) throw new Error('Dataset not found');
  }

  async create(input: CreateExperimentInput): Promise<unknown> {
    try {
      await this.requireDataset(input.tenantId, input.datasetId);
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating experiment');
      return await this.db.experiment.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          datasetId: input.datasetId,
          agentVersionIds: input.agentVersionIds,
          scoreConfigIds: input.scoreConfigIds,
          metadata: input.metadata ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create experiment');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.experiment.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { dataset: { select: { id: true, name: true } }, _count: { select: { runItems: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list experiments');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.experiment.findFirst({
        where: { id, tenantId },
        include: {
          dataset: { include: { _count: { select: { items: true } } } },
          runItems: { orderBy: { createdAt: 'asc' }, include: { agentVersion: { select: { version: true } }, datasetItem: { select: { input: true } } } },
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get experiment');
      throw error;
    }
  }

  async delete(tenantId: string, id: string): Promise<void> {
    try {
      const existing = await this.db.experiment.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error('Experiment not found');
      await this.db.experiment.delete({ where: { id } });
      logger.info({ tenantId, id }, 'Deleted experiment');
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to delete experiment');
      throw error;
    }
  }
}
```

- [ ] **Step 2: Write `ExperimentInferenceService`**

```typescript
import { createLogger } from '../logging/logger';
import { InferenceSessionService, type SessionDb } from './inference-session-service';
import { streamChat, createLLMProvider } from '@chatbot/ai';
import type { LLMProvider } from '@chatbot/ai';
import type { SimpleAgentConfig } from '@chatbot/agent-studio';
import { GraphExecutor, type ExecutionServices } from '@chatbot/agent-studio/server';

const logger = createLogger('experiment-inference-service');

export interface ExperimentInferenceDb extends SessionDb {
  agent: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; type: string } | null> };
  agentVersion: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; agentId: string; config: unknown } | null> };
  apiKey: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null> };
}

export interface RunInferenceInput {
  tenantId: string;
  agentVersionId: string;
  input: unknown;
  provider: LLMProvider;
  userId: string;
}

export class ExperimentInferenceService {
  private readonly sessionService: InferenceSessionService;

  constructor(private readonly db: ExperimentInferenceDb) {
    this.sessionService = new InferenceSessionService(db);
  }

  async run(input: RunInferenceInput): Promise<{ outputText: string; outputJson: unknown; latencyMs: number; tokenUsage: unknown; inferenceSessionId: string }> {
    const startedAt = Date.now();
    const version = await this.db.agentVersion.findFirst({ where: { id: input.agentVersionId, agentId: { not: '' } } }) as { id: string; agentId: string; config: unknown } | null;
    if (!version) throw new Error('Agent version not found');

    const agent = await this.db.agent.findFirst({ where: { id: version.agentId, tenantId: input.tenantId } });
    if (!agent) throw new Error('Agent not found');

    const apiKey = await this.db.apiKey.findFirst({ where: { tenantId: input.tenantId, agentId: agent.id }, orderBy: { createdAt: 'asc' } });
    if (!apiKey) throw new Error('No API key found for agent');

    const userMessage = this.extractUserText(input.input);

    if (agent.type === 'simple') {
      const config = version.config as SimpleAgentConfig;
      const session = await this.sessionService.create({
        apiKeyId: apiKey.id,
        tenantId: input.tenantId,
        agentId: agent.id,
        agentVersionId: version.id,
        name: `experiment-${input.agentVersionId}`,
        channel: 'EXPERIMENT',
      });
      await this.sessionService.appendMessage(session.id, { role: 'user', content: userMessage });

      const result = streamChat({
        provider: input.provider,
        model: config.model ?? undefined,
        system: config.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens ?? 4096,
      });

      const text = await result.text;
      const usage = await result.usage;
      await this.sessionService.appendMessage(session.id, { role: 'assistant', content: text });
      await this.sessionService.endSession(session.id, 'closed');

      const latencyMs = Date.now() - startedAt;
      logger.info({ tenantId: input.tenantId, agentVersionId: version.id, sessionId: session.id, latencyMs }, 'Experiment inference complete');
      return { outputText: text, outputJson: { text }, latencyMs, tokenUsage: usage, inferenceSessionId: session.id };
    }

    // Graph agents
    const executor = new GraphExecutor({} as ExecutionServices); // real impl injects services
    const finalState = await executor.execute(version.config as any, { messages: [{ role: 'user', content: userMessage }] }, {
      executionId: `experiment-${Date.now()}`,
      agentId: agent.id,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const text = Array.isArray(finalState.channels?.output)
      ? finalState.channels.output.map((m: any) => m.content).join('\n')
      : String(finalState.channels?.output ?? '');
    const latencyMs = Date.now() - startedAt;
    return { outputText: text, outputJson: finalState.channels, latencyMs, tokenUsage: null, inferenceSessionId: '' };
  }

  private extractUserText(input: unknown): string {
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      if (typeof obj.content === 'string') return obj.content;
      if (typeof obj.q === 'string') return obj.q;
      if (Array.isArray(obj.messages)) {
        const lastUser = [...obj.messages].reverse().find((m: any) => m.role === 'user');
        if (lastUser?.content) return String(lastUser.content);
      }
    }
    return JSON.stringify(input);
  }
}
```

Note: the graph path in `ExperimentInferenceService` needs real `ExecutionServices` (tools, KB, MCP, provider). For the plan, mark this as requiring the same service bag used by `POST /api/v1/inference` (tools + provider resolution).

- [ ] **Step 3: Write `ExperimentRunnerService`**

```typescript
import { createLogger } from '../logging/logger';
import type { ExperimentInferenceDb } from './experiment-inference-service';
import { ExperimentInferenceService } from './experiment-inference-service';
import type { LLMProvider } from '@chatbot/ai';

const logger = createLogger('experiment-runner-service');

export interface ExperimentRunnerDb extends ExperimentInferenceDb {
  experiment: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<ExperimentRow | null> };
  datasetItem: { findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<Array<{ id: string; input: unknown }>> };
  experimentRunItem: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface ExperimentRow {
  id: string;
  tenantId: string;
  datasetId: string;
  agentVersionIds: string[];
  scoreConfigIds: string[];
  status: string;
}

export interface RunExperimentInput {
  tenantId: string;
  experimentId: string;
  provider: LLMProvider;
  userId: string;
}

export class ExperimentRunnerService {
  private readonly inferenceService: ExperimentInferenceService;

  constructor(private readonly db: ExperimentRunnerDb) {
    this.inferenceService = new ExperimentInferenceService(db);
  }

  async run(input: RunExperimentInput): Promise<void> {
    try {
      const experiment = await this.db.experiment.findFirst({
        where: { id: input.experimentId, tenantId: input.tenantId },
      }) as ExperimentRow | null;
      if (!experiment) throw new Error('Experiment not found');

      logger.info({ tenantId: input.tenantId, experimentId: experiment.id }, 'Starting experiment run');
      await this.db.experiment.update({ where: { id: experiment.id }, data: { status: 'RUNNING' } });

      const items = await this.db.datasetItem.findMany({ where: { datasetId: experiment.datasetId, status: 'ACTIVE' } });
      let completed = 0;
      let failed = 0;

      for (const item of items) {
        for (const agentVersionId of experiment.agentVersionIds) {
          const runItem = await this.db.experimentRunItem.create({
            data: {
              experimentId: experiment.id,
              tenantId: input.tenantId,
              datasetItemId: item.id,
              agentVersionId,
              status: 'RUNNING',
            },
          }) as { id: string };

          try {
            const result = await this.inferenceService.run({
              tenantId: input.tenantId,
              agentVersionId,
              input: item.input,
              provider: input.provider,
              userId: input.userId,
            });
            await this.db.experimentRunItem.update({
              where: { id: runItem.id },
              data: {
                status: 'COMPLETED',
                outputText: result.outputText,
                outputJson: result.outputJson as any,
                latencyMs: result.latencyMs,
                tokenUsage: result.tokenUsage as any,
                inferenceSessionId: result.inferenceSessionId,
              },
            });
            completed++;
          } catch (err) {
            failed++;
            await this.db.experimentRunItem.update({
              where: { id: runItem.id },
              data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
            });
            logger.error({ err, runItemId: runItem.id }, 'Experiment run item failed');
          }
        }
      }

      await this.db.experiment.update({
        where: { id: experiment.id },
        data: { status: failed > 0 && completed === 0 ? 'FAILED' : 'COMPLETED' },
      });
      logger.info({ tenantId: input.tenantId, experimentId: experiment.id, completed, failed }, 'Experiment run complete');
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, experimentId: input.experimentId }, 'Failed to run experiment');
      throw error;
    }
  }
}
```

**Verification commands:**

```bash
nx test shared -- experiment-service
nx test shared -- experiment-runner-service
nx test shared -- experiment-inference-service
```

---

## Task 10: Experiment worker job

**Files:**
- Create: `apps/workers/src/jobs/experiment-run/schema.ts`
- Create: `apps/workers/src/jobs/experiment-run/handler.ts`
- Create: `apps/workers/src/jobs/experiment-run/register.ts`
- Modify: `apps/workers/src/index.ts`, `apps/workers/src/job-runner.ts`

### Interfaces

**Consumes:** `ExperimentRunnerService`, `LlmProviderService`, `createLLMProvider`, `getPrismaClient`.

### Steps

- [ ] **Step 1: Write schema**

```typescript
import { z } from 'zod';

export const experimentRunJobSchema = z.object({
  experimentId: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
});

export type ExperimentRunJobData = z.infer<typeof experimentRunJobSchema>;
```

- [ ] **Step 2: Write handler**

```typescript
import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { ExperimentRunnerService, LlmProviderService, createLogger } from '@chatbot/shared/workers';
import { createLLMProvider } from '@chatbot/ai';
import { experimentRunJobSchema } from './schema.js';

const log = createLogger('experiment-run');

export async function handleExperimentRun(data: unknown, _boss?: PgBoss): Promise<void> {
  const { experimentId, tenantId, userId } = experimentRunJobSchema.parse(data);
  log.info({ experimentId, tenantId }, 'Starting experiment run job');

  const db = getPrismaClient();
  const runner = new ExperimentRunnerService(db as any);
  const llmService = new LlmProviderService(tenantId);
  const config = await llmService.getDefaultConfig();
  const provider = createLLMProvider(config);

  await runner.run({ tenantId, experimentId, provider, userId });
}
```

- [ ] **Step 3: Write register file** following the pattern in Task 4.

- [ ] **Step 4: Register in `apps/workers/src/index.ts` and `job-runner.ts`.**

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/workers/tsconfig.json
nx test workers -- experiment-run
```

---

## Task 11: Experiments API routes

**Files:**
- Create: `apps/web-ui/app/api/evaluation/experiments/route.ts`
- Create: `apps/web-ui/app/api/evaluation/experiments/[id]/route.ts`
- Create: `apps/web-ui/app/api/evaluation/experiments/[id]/run/route.ts`

### Interfaces

**Consumes:** `ExperimentService`, `pg-boss`, `authorize`, session helpers.

### Steps

- [ ] **Step 1: Implement list/create and get/delete routes** following existing patterns.
- [ ] **Step 2: Implement run enqueue route**

```typescript
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('update', 'Experiment', authOptions);
    if (authError) return authError;
    const boss: PgBoss = (globalThis as any).__pgBoss__;
    if (!boss) throw new Error('pg-boss not initialized');
    const jobId = await boss.send('experiment-run', { experimentId: id, tenantId, userId });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) { return evalError(error, logger, 'enqueue experiment run'); }
}
```

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
```

---

## Task 12: Experiments UI pages

**Files:**
- Create: `apps/web-ui/app/(dashboard)/evaluation/experiments/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/evaluation/experiments/[id]/page.tsx`

### Interfaces

**Consumes:** experiment API routes, dataset API, agent version API, React Query, DataTable, Card, Badge, Progress.

### Steps

- [ ] **Step 1: Build list page**

Columns:
- Name + description
- Dataset name
- Agent version numbers (badge list)
- Status badge
- Run count / total items
- Actions: View, Delete, Run

"New experiment" button opens a dialog to select dataset, agent versions, score configs.

- [ ] **Step 2: Build detail page**

Sections:
- Header: name, dataset, status, run button
- Progress card: completed / failed / total run items
- DataTable of run items:
  - Dataset item input (truncated JSON)
  - Agent version
  - Status badge
  - Output (truncated)
  - Latency
- After run completes, show aggregated scores per agent version if evaluators have run (future enhancement; v1 just shows raw outputs)

**Verification commands:**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
nx build web-ui
```

---

## Task 13: RBAC subject map + sidebar nav + shared exports

**Files:**
- Modify: `libs/shared/src/rbac/types.ts`
- Modify: `apps/web-ui/components/layout/app-sidebar.tsx`
- Modify: `libs/shared/src/index.ts`
- Modify: `libs/shared/src/client.ts`

### Steps

- [ ] **Step 1: Update `SUBJECT_TO_MODULE`**

```typescript
export const SUBJECT_TO_MODULE: Record<string, Module> = {
  // ... existing entries ...
  Evaluator: 'Evaluation',
  AnnotationQueue: 'Evaluation',
  AnnotationQueueItem: 'Evaluation',
  Experiment: 'Evaluation',
  ExperimentRunItem: 'Evaluation',
};
```

- [ ] **Step 2: Update sidebar `evaluationNav`**

```typescript
const evaluationNav = [
  { name: 'Scores', href: '/evaluation/scores', icon: ClipboardCheck },
  { name: 'Datasets', href: '/evaluation/datasets', icon: ListChecks },
  { name: 'Evaluators', href: '/evaluation/evaluators', icon: Bot },
  { name: 'Annotation Queues', href: '/evaluation/annotation-queues', icon: Users },
  { name: 'Experiments', href: '/evaluation/experiments', icon: FlaskConical },
];
```

Add `FlaskConical` to the lucide import.

- [ ] **Step 3: Export new services and types from `libs/shared/src/index.ts`**

```typescript
export { EvaluatorService } from './services/evaluator-service';
export type { CreateEvaluatorInput, UpdateEvaluatorInput, EvaluatorDb } from './services/evaluator-service';
export { EvaluatorRunnerService } from './services/evaluator-runner-service';
export type { RunEvaluatorInput, EvaluatorRunnerDb } from './services/evaluator-runner-service';
export { AnnotationQueueService } from './services/annotation-queue-service';
export type { CreateAnnotationQueueInput, UpdateAnnotationQueueInput, AnnotationQueueDb } from './services/annotation-queue-service';
export { AnnotationQueueItemService } from './services/annotation-queue-item-service';
export type { ReviewQueueItemInput, AnnotationQueueItemDb } from './services/annotation-queue-item-service';
export { ExperimentService } from './services/experiment-service';
export type { CreateExperimentInput, UpdateExperimentInput, ExperimentDb } from './services/experiment-service';
export { ExperimentRunnerService } from './services/experiment-runner-service';
export type { RunExperimentInput, ExperimentRunnerDb } from './services/experiment-runner-service';
export { ExperimentInferenceService } from './services/experiment-inference-service';
export type { RunInferenceInput, ExperimentInferenceDb } from './services/experiment-inference-service';
```

- [ ] **Step 4: Ensure schemas are exported from `libs/shared/src/client.ts`**

`client.ts` already re-exports `./validation/schemas`, so new schemas are automatically available.

**Verification commands:**

```bash
bunx tsc --noEmit -p libs/shared/tsconfig.json
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
```

---

## Task 14: Final verification

### Steps

- [ ] **Step 1: Shared library tests**

```bash
nx test shared
```

Expected output: all shared unit tests pass, including new service tests.

- [ ] **Step 2: Worker tests**

```bash
nx test workers
```

Expected output: worker tests pass.

- [ ] **Step 3: Web UI type-check and build**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
nx build web-ui
```

Expected output: no TypeScript errors; production build succeeds.

- [ ] **Step 4: Prisma validation**

```bash
bunx prisma validate --schema=./prisma/schema.prisma
bunx prisma migrate status --schema=./prisma/schema.prisma
```

Expected output: schema valid; migration `evaluation_phase_two` applied.

- [ ] **Step 5: End-to-end smoke**

1. Create a score config (NUMERIC 1-5).
2. Create an evaluator linked to it.
3. Run evaluator from UI → verify `Score` rows appear with `source='EVALUATOR'`.
4. Create an annotation queue linked to the same config; populate it → items appear.
5. Review an item → manual score created, item status becomes `REVIEWED`.
6. Create an experiment with a dataset and agent versions; run it.
7. Verify `ExperimentRunItem` rows are populated with outputs and `status='COMPLETED'`.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/evaluation-phase-two
git add prisma/schema.prisma prisma/migrations/ libs/shared/src/services/ libs/shared/src/validation/schemas/evaluation.ts libs/shared/src/index.ts libs/shared/src/rbac/types.ts apps/workers/src/jobs/evaluator-run apps/workers/src/jobs/experiment-run apps/workers/src/index.ts apps/workers/src/job-runner.ts apps/web-ui/app/api/evaluation/ apps/web-ui/app/(dashboard)/evaluation/ apps/web-ui/components/evaluation/evaluator-dialog.tsx apps/web-ui/components/layout/app-sidebar.tsx
git commit -m "feat(evaluation): phase two — evaluators, annotation queues, experiments

Adds LLM-as-judge evaluators, human annotation queues, and dataset experiments comparing agent versions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Notes for the execution agent

1. **Score source extension:** `ScoreService.ingest` needs a small additive change to accept `source?: 'API' | 'EVALUATOR'` defaulting to `'API'`. No schema enum changes.
2. **Graph agents in experiments:** `ExperimentInferenceService` should reuse the same `ExecutionServices` bag built in `POST /api/v1/inference` (tools, MCP, KB, provider). This plan sketches the graph path; implement it symmetrically with the inference route.
3. **LLM provider in worker/evaluator run:** `LlmProviderService.getDefaultConfig()` is tenant-scoped. If no default is configured, fall back to the global Bedrock default via `createLLMProvider()`.
4. **JSON parsing safety:** `EvaluatorRunnerService.parseResult` should wrap `JSON.parse` in a try/catch and throw a validation error with the raw LLM text in the log context.
5. **Experiment run idempotency:** Re-running the same experiment currently appends new `ExperimentRunItem` rows. If idempotency is required later, add a unique constraint on `[experimentId, datasetItemId, agentVersionId]` and upsert instead.
