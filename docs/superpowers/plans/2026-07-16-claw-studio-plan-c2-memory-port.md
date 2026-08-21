# Claw Studio — Plan C2: Port the Agent Ops Memory Subsystem

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port nucleus-cloud-ops' multi-layer agent memory (SEMANTIC / EPISODIC / PROCEDURAL + per-thread working memory, with the reconcile judge and episode/procedural layers) into `libs/claw-studio`, adapted to this repo — so Claw's graph (Plan C3) can recall and persist memory.

**Architecture:** Lift the CURRENT nucleus memory files (read live from disk — the repo was recently updated; do NOT trust any cached extraction), changing only the bridges: `agent_memories`→`claw_memories` tables, `getPrismaClient` from `@chatbot/shared`, and embeddings resolved via this repo's `LlmProviderService` (not nucleus' `ProviderModelService`). The pgvector column, HNSW index, and partial-unique-on-live-rows index are raw SQL in the migration (Prisma can't express them). Skill-synthesis (memory→skills coupling) is **stubbed** in C2 and wired for real in C4.

**Source of truth:** `/Users/H2702/.superset/projects/nucleus-cloud-ops` @ `master-v1`, paths under `apps/web-ui/lib/agent/`. Every port task READS the current source file and adapts it — do not transcribe from memory.

## Global Constraints

- **Read the CURRENT nucleus source** for every ported file (the repo is actively updated). Match its current logic; adapt only the documented bridges.
- **Bridges (the only intended changes):** table `agent_memories`→`claw_memories`, `agent_working_memory`→`claw_working_memory`; `getPrismaClient`/`createLogger` from `@chatbot/shared`; embeddings from a new `claw` embeddings module backed by `LlmProviderService.getDefaultConfig()` (this repo), NOT `ProviderModelService`.
- **pgvector specifics** (Prisma can't model these — put in the migration as raw SQL): `embedding vector(1024)` column, HNSW cosine index, and the **partial unique index** `... (tenantId, namespace, key) WHERE supersededById IS NULL`. Follow the repo's existing raw-SQL-in-migration precedent (the KB `idx_document_chunks_embedding` HNSW index).
- **Skill-synthesis is OUT of scope for C2** — where nucleus' `memory-nodes` save path calls `synthesizeDomainSkills(...)`, port a no-op stub (a `synthesizeDomainSkills` that returns immediately with a `// TODO(C4): wire to Claw skills` — single-line comment only) so memory works standalone. C4 replaces it.
- **Feature flags default ON** in nucleus (reconcile/episodic/procedural/working-memory). Keep that behavior; declare the new env vars in `libs/claw-studio`'s env handling (or read via a small typed helper) — do NOT read `process.env` directly in a way that violates the repo's T3 rule; mirror nucleus' flag helpers but keep them lib-local.
- **Standards:** typed params (no implicit any); try/catch + Pino where nucleus logs; the raw pgvector SQL must bind `tenantId` explicitly (multi-tenant safety — `$queryRaw` is not tenant-intercepted).
- **Deps:** add `@langchain/langgraph-checkpoint-postgres` (for `PostgresSaver`) to root `package.json`. `@langchain/aws` (`BedrockEmbeddings`) and `@langchain/openai` (`OpenAIEmbeddings`) are already installed.
- **Tests can't call live embeddings** (no Bedrock creds in dev) — port nucleus' memory tests but ensure they mock embeddings / use the recency-fallback path so they pass offline. State which paths are covered vs deferred.

---

### Task 1: Prisma models + pgvector migration + checkpoint dep

**Files:**
- Modify: `prisma/schema.prisma` (add `MemoryKind` enum if absent, `ClawMemory`, `ClawWorkingMemory`; add relations)
- Create: the migration (`bunx prisma migrate dev --name add_claw_memory`), then **hand-edit** the generated SQL to add the pgvector column type, HNSW index, and partial unique index
- Modify: root `package.json` (add `@langchain/langgraph-checkpoint-postgres`)

**Interfaces:** Produces `claw_memories` + `claw_working_memory` tables with a live-rows partial unique index and an HNSW cosine index on a `vector(1024)` embedding column.

- [ ] **Step 1: Read the nucleus models + migrations**
Read `libs/prisma/schema.prisma` `AgentMemory`/`AgentWorkingMemory`/`MemoryKind` and the two migrations `20260701235449_agent_memory_foundation` + `20260702092242_agent_memory_partial_unique` in nucleus. These are your reference.

- [ ] **Step 2: Add the Prisma models** (mirror nucleus, renamed). In `prisma/schema.prisma`:
  - Add `enum MemoryKind { SEMANTIC EPISODIC PROCEDURAL }` (if not already present in this repo).
  - Add `ClawMemory` mapping to `@@map("claw_memories")` with the **exact columns nucleus' `AgentMemory` has, unchanged**: `id`, `tenantId`, `userId`, `namespace`, `key`, `value Json`, `kind MemoryKind @default(SEMANTIC)`, `embedding Unsupported("vector(1024)")?`, `sourceThreadId String?`, `supersededById String?`, `supersededAt DateTime?`, `lastAccessedAt DateTime?`, `accessCount Int @default(0)`, `createdAt`, `updatedAt`, `expiresAt DateTime`. Indexes exactly as nucleus: `@@index([tenantId, namespace, key])`, `@@index([tenantId, userId])`, `@@index([tenantId, kind])`, `@@index([expiresAt])`. **No `@@unique`** (partial unique is raw SQL). `@@map("claw_memories")`. **Do NOT add a `clawId` column** — keep the schema identical to nucleus; the Claw's identity is carried in the existing `userId` field (see the scoping note below).
  - Add `ClawWorkingMemory` mirroring `AgentWorkingMemory` (fields `runningSummary @db.Text`, `scratchpad Json`, `tokenCount`, `turnCount`, `expiresAt`; `@@unique([tenantId, threadId])`; `@@map("claw_working_memory")`).
  - Decide on relations: keep `tenantId`/`clawId` as scalar columns (app-enforced), consistent with the Claw Studio pattern.

- [ ] **Step 3: Validate + generate the migration**
`bunx prisma validate --schema=./prisma/schema.prisma` → valid.
`bunx prisma migrate dev --name add_claw_memory --schema=./prisma/schema.prisma`. This creates the tables but WITHOUT the pgvector type / special indexes (Prisma emits `embedding` as an unsupported/absent column).

- [ ] **Step 4: Hand-edit the generated migration SQL** to add the raw pieces (append to the generated `migration.sql`):
```sql
-- pgvector column (Prisma leaves Unsupported columns out or as bytea)
ALTER TABLE "claw_memories" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
-- HNSW cosine index for similarity search
CREATE INDEX IF NOT EXISTS "claw_memories_embedding_hnsw" ON "claw_memories" USING hnsw ("embedding" vector_cosine_ops);
-- partial unique index: only LIVE (non-superseded) rows are unique per (tenant, namespace, key)
CREATE UNIQUE INDEX IF NOT EXISTS "claw_memories_live_tenant_ns_key" ON "claw_memories" ("tenantId","namespace","key") WHERE "supersededById" IS NULL;
```
Then apply with `bunx prisma migrate deploy --schema=./prisma/schema.prisma` (or re-run migrate dev if it prompts cleanly). **Guard against the drift footgun:** confirm this migration does NOT drop `idx_document_chunks_embedding` (the recurring KB-index drop). If the diff includes that DROP, remove it or add a restore, exactly as in Plan A.

- [ ] **Step 5: Verify** the columns/indexes exist:
```
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRawUnsafe(\"SELECT indexname FROM pg_indexes WHERE tablename='claw_memories'\").then(r=>{console.log(r);return p.\$disconnect()}).then(()=>process.exit(0))"
```
Expect rows including `claw_memories_embedding_hnsw` and `claw_memories_live_tenant_ns_key`.

- [ ] **Step 6: Add the checkpoint dep** to root `package.json` dependencies: `@langchain/langgraph-checkpoint-postgres` (match a version compatible with the installed `@langchain/langgraph@1.4.8` — check nucleus' pinned version). `bun install`. `bunx prisma generate`.

- [ ] **Step 7: Commit**
```
git add prisma/schema.prisma prisma/migrations package.json bun.lock
git commit -m "feat(claw-studio): claw_memories + claw_working_memory models (pgvector, partial unique)"
```

---

### Task 2: Embeddings bridge + shared memory types

**Files:**
- Create: `libs/claw-studio/src/memory/types.ts` (port nucleus `memory/types.ts`)
- Create: `libs/claw-studio/src/memory/embeddings.ts` (bridge `getTenantEmbeddings` to this repo's `LlmProviderService`)
- Test: `libs/claw-studio/src/memory/embeddings.test.ts`

**Interfaces:** Produces `getClawEmbeddings(tenantId): Promise<Embeddings>` (1024-dim) + the `MemoryKind`/`MemoryHit`/`ExtractedFact`/`ReconcileAction`/etc. types.

- [ ] **Step 1:** Port `memory/types.ts` verbatim from nucleus (read current file); it has no repo-specific imports. Adjust only if it imports something nucleus-specific.
- [ ] **Step 2:** Read nucleus `lib/agent/embeddings-factory.ts`. Create `libs/claw-studio/src/memory/embeddings.ts` with `createClawEmbeddings(config)` + `getClawEmbeddings(tenantId)`:
  - `getClawEmbeddings(tenantId)` resolves the tenant's default provider via `new LlmProviderService(tenantId).getDefaultConfig()` (this repo — returns `{provider, embeddingModel, region, apiKey, accessKeyId, secretAccessKey, embeddingDimensions}`); throws a typed error if none.
  - `createClawEmbeddings(config)` mirrors nucleus: `bedrock`→`BedrockEmbeddings` (from `@langchain/aws`, `dimensions: 1024` for titan-v2); `anthropic`→throw (no embeddings); else→`OpenAIEmbeddings` (from `@langchain/openai`, `dimensions: 1024` for text-embedding-3). Enforce the 1024-dim requirement.
  - Per-tenant cache `Map<string, Promise<Embeddings>>`, evict rejected.
- [ ] **Step 3:** Test (offline): assert `createClawEmbeddings({provider:'bedrock', embeddingModel:'amazon.titan-embed-text-v2:0', region, accessKeyId, secretAccessKey})` returns a `BedrockEmbeddings`; openai-compatible returns `OpenAIEmbeddings`; anthropic throws; dimension mismatch throws. (Construction only — no network.)
- [ ] **Step 4:** Export from `libs/claw-studio/src/index.ts`; `bunx nx typecheck claw-studio`; run tests.
- [ ] **Step 5:** Commit `feat(claw-studio): memory types + per-tenant embeddings bridge (LlmProvider)`.

---

### Task 3: `MemoryService` (pgvector data layer)

**Files:**
- Create: `libs/claw-studio/src/memory/memory-service.ts` (port nucleus `memory/memory-service.ts`)
- Test: `libs/claw-studio/src/memory/memory-service.test.ts` (port nucleus' test, adapted)

- [ ] **Step 1:** Read nucleus `lib/agent/memory/memory-service.ts` + its test. Port the class + `getMemoryService()` **verbatim**, changing ONLY: table name `agent_memories`→`claw_memories`; `getPrismaClient` import → `@chatbot/shared`; embeddings → `getClawEmbeddings` (Task 2). Keep `RememberParams`/`RecallParams` and the raw pgvector SQL (upsert with `ON CONFLICT (...) WHERE "supersededById" IS NULL`, cosine `<=>` recall, recency fallback, id-scoped reinforcement) EXACTLY as nucleus — including the `(tenantId, userId)` scoping. Do NOT add a `clawId` param; the Claw's identity flows in as `userId` (set by the graph in C3).
- [ ] **Step 2:** Port the test, adapting to the recency-fallback path (mock/skip embeddings so it runs offline against the local pgvector DB), or mock the prisma layer as nucleus' test does. Confirm remember→recall round-trips and supersede/reinforce behavior. Run against the local DB (it's up).
- [ ] **Step 3:** Export; typecheck; test. Commit `feat(claw-studio): MemoryService pgvector data layer`.

---

### Task 4: Cognitive layers — reconcile, episode, procedural, working-memory, log

**Files:**
- Create: `libs/claw-studio/src/memory/{reconcile,episode,procedural,working-memory,log}.ts` (port each from nucleus)
- Test: port the corresponding `*.test.ts` for each

- [ ] **Step 1:** Read + port each nucleus file (`memory/reconcile.ts`, `episode.ts`, `procedural.ts`, `working-memory.ts`, `log.ts`), changing only imports (`getMemoryService` → local Task-3 service; types → Task-2 types; `createLogger` → `@chatbot/shared`). Keep the LLM-judge/distiller/folder logic, constants (`RECONCILE_TOP_K=5`, thresholds `0.55`/`0.65`, limits), and the fail-open behavior EXACTLY.
- [ ] **Step 2:** Keep the feature-flag helpers (`reconcileEnabled`/`episodicMemoryEnabled`/`proceduralMemoryEnabled`/`memoryLogVerbose`) as lib-local functions reading their env vars (default ON), mirroring nucleus.
- [ ] **Step 3:** Port each test (they use fake models — offline-safe). Run all. Fix any import drift.
- [ ] **Step 4:** Export the public pieces; typecheck; test. Commit `feat(claw-studio): memory cognitive layers (reconcile, episode, procedural, working memory)`.

---

### Task 5: Graph memory nodes + persistence (checkpointer + store)

**Files:**
- Create: `libs/claw-studio/src/memory/memory-nodes.ts` (port nucleus `lib/agent/memory-nodes.ts`)
- Create: `libs/claw-studio/src/agent/persistence.ts` (port nucleus `lib/agent/persistence.ts`)
- Test: port `memory-nodes` coverage; a persistence smoke test
- Modify: `libs/claw-studio/src/index.ts`

- [ ] **Step 1:** Port `memory-nodes.ts` — `createMemoryRecallNode`/`createMemorySaveNode` + deps — **verbatim**, adapting only imports to the local memory service/layers + `@chatbot/shared` logger. Keep nucleus' `MemoryNodeDeps` (`{ reflectorModel, tenantId?, userId?, store }`) exactly — the graph (C3) supplies the Claw's identity as `userId`. **STUB skill synthesis:** replace the `synthesizeDomainSkills(...)` call with a local no-op `async function synthesizeDomainSkills() { /* wired in C4 */ }` (single-line comment). Keep the recall (SEMANTIC LLM-filter + PROCEDURAL/EPISODIC distance-gated) and save (extract→reconcile→episode) flows intact.
- [ ] **Step 2:** Port `persistence.ts` — `getCheckpointer()` (`PostgresSaver.fromConnString(env.DATABASE_URL)` + `setup()`), `getMemoryStore()` (`PostgresMemoryStore` over `claw_memories`), `saveMemory`/`searchMemory`. Adapt `PostgresMemoryStore`'s raw SQL to `claw_memories` + `getClawEmbeddings`. `DATABASE_URL` via a typed env accessor (not raw process.env). If nucleus' `PostgresChatHistory` targets a `chatMessage` model this repo lacks, OMIT it (Claw uses the checkpointer for thread state; note the omission) — port only checkpointer + store.
- [ ] **Step 3:** Tests: a memory-nodes test with a `FakeListChatModel` reflector asserting recall composes context and save extracts+persists (mock the service or run against local DB with recency fallback); a persistence smoke test that `getCheckpointer()` constructs + `setup()` runs against the local DB. Offline-safe.
- [ ] **Step 4:** Export `createMemoryRecallNode`, `createMemorySaveNode`, `getCheckpointer`, `getMemoryStore`, `getMemoryService`, `getClawEmbeddings` from `libs/claw-studio/src/index.ts`. `bunx nx typecheck claw-studio`; run all lib tests; `bunx nx build claw-studio`.
- [ ] **Step 5:** Commit `feat(claw-studio): memory graph nodes + Postgres checkpointer/store`.

---

## Self-Review

**Spec coverage:** C2 delivers the full memory subsystem (spec §7 memory nodes + §4 `ClawMemory`/`ClawWorkingMemory`). Skill-synthesis coupling is stubbed (C4). The executor-graph that USES these nodes is C3.

**Port fidelity:** each task reads the current nucleus file and ports it VERBATIM, changing only the documented bridges (table names, `getPrismaClient`/logger imports, embeddings via `LlmProviderService`, skill-synthesis stub). Schema shape, `(tenantId, userId)` scoping, and raw pgvector SQL (partial unique + HNSW + cosine recall) preserved exactly. The Claw's identity is carried in the existing `userId` field (wired in C3), so no memory-code deviation is needed.

**Risks:** (1) live embeddings unavailable in dev → tests use recency-fallback/mocks, real vector recall verified later with Bedrock creds; (2) the pgvector/partial-unique/HNSW migration must be hand-edited and must not drop the KB index (Plan A footgun); (3) `@langchain/langgraph-checkpoint-postgres` version must match `@langchain/langgraph@1.4.8`.

---

## Next: **C3** ports the executor-graph (`executor-graphs.ts` + `executor-state.ts` + de-AWS'd `prompt-templates.ts` + tool assembly), wiring these memory nodes in and REPLACING the C1 stub graph. Then C4 skills (un-stubs synthesis), C5 MCP, C6 connectors. Module `CLAUDE.md` lands with C3.
