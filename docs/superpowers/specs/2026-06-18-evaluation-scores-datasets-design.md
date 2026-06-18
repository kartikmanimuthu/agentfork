# Evaluation Module — Scores + Datasets

**Date:** 2026-06-18
**Status:** Approved (design)
**Scope:** First slice of a Langfuse-style Evaluation module: **Scores** and **Datasets** only.

## 1. Goal & Scope

Introduce a new tenant-scoped **Evaluation** module to the chatbot platform, modeled on Langfuse's evaluation suite. This first slice delivers two capabilities:

- **Scores** — config-driven, typed grades (Numeric / Categorical / Boolean) attached to real production chat traces (`InferenceSessionMessage`, `InferenceSession`). Created manually in-dashboard by reviewers, or ingested programmatically via an authenticated API.
- **Datasets** — curated, versionless collections of items (`input` + optional `expectedOutput` + metadata). Populated by manual form entry, "add from trace", or CSV/JSON bulk import.

### Explicitly out of scope (future specs)

- Experiments / dataset runs (running agent versions against datasets and comparing).
- Human Annotation queues (routing items to reviewers).
- LLM-as-judge Evaluators (automated background scoring).
- Scoring dataset items (scores attach only to messages/sessions in this slice).
- Any change to existing `MessageFeedback` / `CsatResponse` — these remain wholly independent and untouched.
- Dataset item version history (items are mutable; soft-archive only).

## 2. Background — existing platform primitives

- Multi-tenant; everything tenant-scoped. RBAC lives in `libs/shared/src/rbac` with a `Module` / `Action` model (`permissions.ts`, `types.ts`).
- Traces that scores attach to: `InferenceSession` and `InferenceSessionMessage` (in `prisma/schema.prisma`).
- Existing scoring-like primitives (`MessageFeedback`, `CsatResponse`, `SessionAnalytics`) are **end-user-generated** signals and are intentionally left independent of this module.
- Services follow a class-based pattern with an injected Prisma client + Pino logger (see `libs/shared/src/services/feedback-service.ts`).
- Dashboard is route-grouped under `apps/web-ui/app/(dashboard)/` with a collapsible sidebar (`apps/web-ui/components/layout/app-sidebar.tsx`).
- API-key auth pattern for the public API lives in `apps/web-ui/app/api/v1/inference/lib/auth.ts` (`validateInferenceApiKey`).

## 3. Data Model (Prisma)

Four new models. All carry `tenantId` and cascade-delete from `Tenant`. New back-relations are added to `Tenant`, `InferenceSession`, and `InferenceSessionMessage`.

### `ScoreConfig`

The reusable definition of a score. Reviewers pick from configs so names and scales stay consistent.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id cuid | |
| `tenantId` | String | FK → Tenant, Cascade |
| `name` | String | |
| `description` | String? | |
| `dataType` | String | `NUMERIC` \| `CATEGORICAL` \| `BOOLEAN` |
| `minValue` | Float? | NUMERIC only (optional bound) |
| `maxValue` | Float? | NUMERIC only (optional bound) |
| `categories` | Json? | CATEGORICAL only: `[{ label: string, value: number }]` |
| `isArchived` | Boolean @default(false) | soft-disable; existing scores retained |
| `createdBy` | String | userId |
| `createdAt` / `updatedAt` | DateTime | |

Constraints: `@@unique([tenantId, name])`, `@@index([tenantId])`, `@@index([tenantId, isArchived])`. Relation: `scores Score[]`.

### `Score`

An actual recorded value referencing a config, attached to exactly one trace target.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id cuid | |
| `tenantId` | String | FK → Tenant, Cascade |
| `configId` | String | FK → ScoreConfig, Restrict |
| `targetType` | String | `MESSAGE` \| `SESSION` |
| `messageId` | String? | FK → InferenceSessionMessage, SetNull |
| `sessionId` | String? | FK → InferenceSession, SetNull |
| `numericValue` | Float? | NUMERIC value; BOOLEAN 0/1; CATEGORICAL mapped value |
| `stringValue` | String? | CATEGORICAL label (and human-readable BOOLEAN) |
| `comment` | String? | |
| `source` | String | `ANNOTATION` (manual/dashboard) \| `API` (ingested) |
| `authorUserId` | String? | reviewer for manual scores; null for API |
| `createdAt` / `updatedAt` | DateTime | |

**Value storage by config `dataType`:**
- `NUMERIC` → `numericValue`.
- `BOOLEAN` → `numericValue` ∈ {0, 1}; `stringValue` = `"true"`/`"false"`.
- `CATEGORICAL` → `stringValue` = the chosen label; `numericValue` = that label's mapped value from the config (if defined).

Constraints: exactly one of `messageId` / `sessionId` is set (enforced in service, consistent with `targetType`). Indexes: `@@index([tenantId])`, `@@index([messageId])`, `@@index([sessionId])`, `@@index([configId])`, `@@index([tenantId, source])`.

### `Dataset`

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id cuid | |
| `tenantId` | String | FK → Tenant, Cascade |
| `name` | String | |
| `description` | String? | |
| `metadata` | Json? | |
| `createdBy` | String | userId |
| `createdAt` / `updatedAt` | DateTime | |

Constraints: `@@unique([tenantId, name])`, `@@index([tenantId])`. Relation: `items DatasetItem[]`.

### `DatasetItem`

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id cuid | |
| `datasetId` | String | FK → Dataset, Cascade |
| `input` | Json | required |
| `expectedOutput` | Json? | |
| `metadata` | Json? | |
| `status` | String @default("ACTIVE") | `ACTIVE` \| `ARCHIVED` |
| `sourceMessageId` | String? | provenance when added from a trace |
| `sourceSessionId` | String? | provenance when added from a trace |
| `createdBy` | String | userId |
| `createdAt` / `updatedAt` | DateTime | |

Indexes: `@@index([datasetId])`, `@@index([datasetId, status])`.

> Note: no `datasetItemId` on `Score` in this slice — scores do not attach to dataset items yet.

## 4. Services (`libs/shared/src/services`)

Class-based, Prisma client injected via constructor, Pino logger, all logic wrapped in try/catch with structured logging — mirroring `feedback-service.ts`. Each gets a sibling `*.test.ts`.

### `ScoreConfigService`
- `create(input)` — validates type-specific constraints (`minValue < maxValue` when both set; non-empty `categories` with unique labels for CATEGORICAL; `categories`/`min`/`max` rejected for mismatched types).
- `list(tenantId, { includeArchived })`, `get(tenantId, id)`, `update(tenantId, id, patch)`, `archive(tenantId, id)`.

### `ScoreService`
- `createManual(input)` — `source = ANNOTATION`; emulates upsert via find-then-update/create on (`configId`, target, `authorUserId`) so a reviewer re-scoring overwrites their prior value. (No DB unique constraint — the nullable `messageId`/`sessionId` pair makes a Postgres unique impractical; the service enforces it.)
- `ingest(input)` — `source = API`; always creates.
- Both validate the value against the referenced config (range for NUMERIC, membership for CATEGORICAL, 0/1 for BOOLEAN) and enforce exactly-one-target consistent with `targetType`; verify target row belongs to `tenantId`.
- `listByTarget(tenantId, targetType, targetId)`, `listByTenant(tenantId, filters)` (filters: `configId`, `targetType`, `source`, date range), `delete(tenantId, id)`.

### `DatasetService`
- `create / list / get / update / delete` — all tenant-scoped; `delete` cascades items.

### `DatasetItemService`
- `create(datasetId, input)`, `bulkCreate(datasetId, rows)`, `addFromTrace(datasetId, { targetType, targetId })` (resolves a message/session into `input` = user content, `expectedOutput` = assistant content, sets `sourceMessageId`/`sourceSessionId`), `list(datasetId, { status })`, `update`, `archive`, `delete`.

## 5. Validation (`libs/shared/src/validation`)

Zod schemas for every input, reused at both the API boundary and frontend forms:
- `scoreConfigCreateSchema` / `scoreConfigUpdateSchema` (discriminated on `dataType`).
- `scoreManualCreateSchema` / `scoreIngestSchema`.
- `datasetCreateSchema` / `datasetUpdateSchema`.
- `datasetItemCreateSchema` / `datasetItemBulkRowSchema` / `addFromTraceSchema`.

Each schema has a sibling unit test asserting accept/reject cases.

## 6. API Surface

### Dashboard (NextAuth session + `x-tenant-id` header)
- `GET|POST /api/evaluation/score-configs`
- `GET|PATCH|DELETE /api/evaluation/score-configs/[id]` (DELETE = archive)
- `GET|POST /api/evaluation/scores` (GET: filtered list; POST: manual score)
- `PATCH|DELETE /api/evaluation/scores/[id]`
- `GET|POST /api/evaluation/datasets`
- `GET|PATCH|DELETE /api/evaluation/datasets/[id]`
- `GET|POST /api/evaluation/datasets/[id]/items` (POST supports single + bulk)
- `POST /api/evaluation/datasets/[id]/items/from-trace`
- `PATCH|DELETE /api/evaluation/datasets/[id]/items/[itemId]`

All handlers: Zod-validate at the boundary, authorize against the `Evaluation` RBAC module, try/catch with Pino logging, typed JSON error responses.

### Ingestion API (API-key auth)
- `POST /api/v1/scores` — `Bearer` API key. Reuses the `validateInferenceApiKey` pattern, extended to require a new `scores:write` scope. Resolves `tenantId` from the key, verifies the target message/session belongs to that tenant, writes a `Score` with `source = API`. Returns `401` (bad key), `403` (missing scope), `422` (validation), `404` (target not in tenant).

## 7. RBAC

- Add `'Evaluation'` to the `Module` union in `libs/shared/src/rbac/types.ts`.
- Grant in `ROLE_PERMISSIONS` (`permissions.ts`): Owner/Admin → `['create','read','update','delete']`; Member → `['create','read','update']`; Viewer → `['read']`. Update `getAutoLevel`'s `maxPossible` (now 8 modules × 4 actions).
- Add an entry to `SUBJECT_TO_MODULE`.
- Add `scores:write` to the API-key scope vocabulary used by `api-key-service.ts` and surfaced in the API-key creation UI.

## 8. UI (shadcn/ui only) + Navigation

New sidebar group **"Evaluation"** (`ClipboardCheck` icon), placed after the Analytics group in `app-sidebar.tsx`, with collapsible sub-items **Scores** and **Datasets**.

Routes under `apps/web-ui/app/(dashboard)/`:
- `/evaluation/scores` — scores table with filters (config, target type, source, date). **Score Configs** managed in a second tab on the same page (create/edit/archive dialog per `dataType`).
- `/evaluation/datasets` — datasets list with create dialog.
- `/evaluation/datasets/[id]` — dataset detail: items table, add-item dialog (manual form), "Import" dialog (CSV/JSON), per-row archive/delete.

**Inline scoring:** a "Score" drawer/panel added to the existing inference detail page (`apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx`), letting a reviewer pick a `ScoreConfig` and record a score on the session or on an individual message, and showing existing scores for that trace. The "Add to dataset" action also lives here (feeds `addFromTrace`).

All forms use shadcn components exclusively, validated client-side with the shared Zod schemas before submission.

## 9. Error Handling, Logging, Testing

- **Error handling:** every route handler and service method wrapped in try/catch; caught errors logged (never swallowed) and re-thrown or returned as typed JSON errors.
- **Logging:** Pino via the shared logger, structured context (`{ tenantId, userId, configId, datasetId, ... }`) at appropriate severities.
- **Testing:** Vitest unit tests per service (injected fake db, like `feedback-service.test.ts`) covering value/type validation, target exclusivity, manual-upsert semantics, archive behavior, and tenant isolation; Zod schema accept/reject tests. E2e is not required for this slice (services + schemas carry the coverage).

## 10. Build Order (for the implementation plan)

1. Prisma models + migration + back-relations.
2. Zod validation schemas (+ tests).
3. Services (+ unit tests): ScoreConfig → Score → Dataset → DatasetItem.
4. RBAC module + API-key scope.
5. Dashboard API routes (score-configs, scores, datasets, items).
6. Ingestion API (`/api/v1/scores`).
7. UI: navigation, `/evaluation/scores` (+ configs tab), `/evaluation/datasets` (+ detail), inline scoring drawer on inference detail.
