# Semantic Response Cache Design

## Overview

Add a second cache tier to the inference API that serves a stored answer when a new prompt *means* the same thing as an earlier one, not only when it is byte-identical. The existing exact-match cache (`llm_response_cache`, `ResponseCacheService`) stays exactly as it is and remains tier 1; the semantic tier is consulted only after an exact miss.

**Approach:** pgvector on the existing PostgreSQL instance. No Redis, no Qdrant, no new extension. The `pg_semantic_cache` extension from pgEdge Labs was evaluated and rejected — see [Alternatives considered](#alternatives-considered).

**Scope:** the stateless inference API only (`POST /api/v1/inference`). Chat channels (WhatsApp, Telegram, SDK widget) and the playground are out of scope for this design.

## Goals and non-goals

**Goals**

- Raise cache hit rate on repetitive question traffic above what exact matching achieves.
- Keep the blast radius of a wrong match small, visible, and reversible.
- Work for every tenant regardless of which LLM provider they configured.
- Add no new infrastructure.

**Non-goals**

- Caching multi-turn or agentic traffic. Consecutive turns are textually near-identical, so semantic matching replays stale answers. This is the boundary LiteLLM, Kong and Azure API Management all draw, and the existing `cacheEligible` gate already enforces it.
- Volatile-query classification. Deliberately deferred; see [Deferred work](#deferred-work).
- Replacing or modifying the exact-match tier beyond the empty-response guard below.

## Eligibility

The semantic tier is consulted only when **all** of the following hold:

1. The existing `cacheEligible` gate passes — `!noCache && !hasMcpTools && !hasBuiltInTools && !sessionId`.
2. Tier 1 (exact) returned a miss.
3. The agent has `semanticCache.enabled === true`.
4. The platform kill switch `SEMANTIC_CACHE_ENABLED` is not `false`.

Failing any of these means the request proceeds exactly as it does today.

### Why each condition exists

**No tools (`!hasMcpTools && !hasBuiltInTools`) — the strongest of the three.**

The obvious argument is staleness: a tool reads live external state, so a cached answer describes a world that has moved on. The real argument is worse. Serving a cached response means **the tool never executes**. If an agent's answer was "I've created ticket #4821 for you", replaying it from cache produces a user who believes a ticket exists when nothing ran. The cache does not merely return stale data — it silently skips the side effect the response is describing.

Published research draws this line explicitly, separating tool calls into *informational* (read-only lookups) and *command* (state-modifying) categories and concluding that command calls require fundamentally different machinery from ordinary caching. The blunt version of that conclusion is this design's rule: if any tool is attached, do not cache. A future refinement could permit caching for agents whose tools are provably read-only, but that requires a per-tool side-effect classification which does not exist in this codebase today.

**No session (`!sessionId`) — the failure mode vendors document by name.**

Two problems compound. Consecutive turns in a conversation are textually near-identical, so similarity matching produces false hits between adjacent turns of the *same* conversation. And identical text means different things in different histories — "yes, go ahead" is not one question with one answer.

LiteLLM's documentation states the rule directly: semantic caching is designed for single-shot prompts, and on multi-turn or agentic traffic it will replay stale responses; use exact-match caching for agentic workloads instead. Azure API Management reaches the same conclusion by a different mechanism — its `max-message-count` attribute skips caching once a dialog exceeds a configured number of messages.

**`noCache` and the kill switches** let a caller or an operator opt out per request or platform-wide without touching configuration.

## Data model

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

A separate table from `llm_response_cache`, not a column on it: different lifecycle, different access pattern, and tier 1 stays untouched.

`tenantId` and `agentVersionId` are stored for operability — per-tenant metrics, targeted invalidation, and debugging. They are not part of the lookup predicate, which filters on `scopeKey` alone.

### The scope key

```
scopeKey = sha256(agentVersionId, systemPrompt, model, temperature, embeddingModel)
```

Every lookup filters by `scopeKey`. This single decision carries three properties:

1. **No cross-agent or cross-tenant leakage.** `agentVersionId` is tenant-scoped, so one agent's answers can never serve another's, and one tenant's can never serve another's.
2. **Automatic invalidation.** Editing a system prompt, changing the model or temperature, or publishing a new version produces a different scope key. Old entries become unreachable and age out on TTL. There is no invalidation code to write and no cache-clear button to forget to press.
3. **Dimension safety.** Because `embeddingModel` is part of the key, every vector within a scope was produced by the same model and therefore has the same dimension. Comparing vectors of mismatched dimensions is structurally impossible rather than validated against.

### Why the vector column has no fixed dimension

Tenants choose their own embedding model (see [Embedding model selection](#embedding-model-selection)), so dimensions vary — 1024 for Titan v2, 1536 for `text-embedding-3-small`, 3072 for `text-embedding-3-large`, and whatever a self-hosted LiteLLM model returns.

pgvector 0.8.2 (verified on the current database) permits a `vector` column with no declared dimension and accepts mixed-dimension values in it. Combined with the scope key including `embeddingModel`, all vectors ever compared to one another share a dimension.

This deliberately avoids repeating the defect currently present in the knowledge base, where `embeddingDimensions` is user-configurable (64–3072, `libs/knowledge-base/src/schemas.ts:63`) while the physical column is `vector(1024)`.

`embeddingDims` is recorded per row for observability and is **measured** from the returned vector's length, never taken from provider metadata.

### Why there is no HNSW index

This is intentional and should not be "fixed" without the measurements below.

The table does have an index: btree on `(scopeKey, expiresAt)`. That is the selective one, narrowing from every row on the platform to one agent's live entries. What is omitted is a vector index, for five reasons:

1. **HNSW is approximate.** It trades recall for speed and can miss the true nearest neighbour. For knowledge base retrieval that is an acceptable trade. For a cache deciding "is this the same question?", a missed match is a silent hit-rate loss with no error to observe.
2. **HNSW post-filters.** The index searches globally and the `scopeKey` predicate discards results afterwards, so a highly selective filter can return zero rows even when good matches exist. pgvector 0.8 mitigates this with iterative index scans, but that introduces `hnsw.ef_search` and `hnsw.iterative_scan` tuning to solve a problem this design does not create.
3. **The workload is wrong for it.** Every cache miss is an INSERT, and rows expire on a TTL measured in minutes to hours. Maintaining a navigable graph over short-lived rows is wasted work, and deletes leave tombstones that pgvector's HNSW does not fully reclaim, requiring periodic `REINDEX`.
4. **The scale is wrong for it.** HNSW earns its cost at 100k–millions of vectors in one search space. Here the search space is a single scope: hundreds to low thousands of rows. Brute-force distance over a pre-filtered set is faster below roughly 10k rows. At 1,024 dimensions × 1,000 rows that is about one million multiply-adds, on the order of 1ms, against an LLM call of 500–2000ms.
5. **It would require fixed dimensions**, reintroducing the tenant-model problem the design exists to avoid.

The dimensionless column *forces* this choice; the workload *justifies* it. Even with fixed dimensions, HNSW would be the wrong call at this scale.

**Revisit trigger.** Add a fixed-dimension column plus an HNSW index for that path when either p95 semantic lookup latency exceeds 50ms, or any single `scopeKey` exceeds 10,000 live rows. Both are measurable; neither is a judgement call.

### Migration notes

No raw-SQL index block is needed for this table, since there is no HNSW index to create. The generated migration will still emit spurious `DROP INDEX "claw_memories_embedding_hnsw"` and `DROP INDEX "idx_document_chunks_embedding"` statements, because Prisma cannot model HNSW indexes on `Unsupported("vector(...)")` columns. **Delete those lines before committing**, per `CLAUDE.md`.

## Embedding model selection

Tenants pick the embedding model the same way they already pick a chat model. This follows from the platform being bring-your-own-provider: a hard-coded platform model would mean a LiteLLM-only tenant enables semantic caching and silently gets nothing, because they have no Bedrock credentials.

The UI reuses `ProviderModelSelect` with `capability="embedding"`, which already exists and already falls back to `provider.embeddingModel` (`apps/web-ui/components/llm-providers/provider-model-select.tsx:42`). When no configured provider exposes an embedding model, the component already renders "No embedding models available from configured providers".

Embeddings are generated through the tenant's own provider via `generateEmbedding()` from `@chatbot/ai`.

### Save-time validation

When an agent is saved with `semanticCache.enabled === true`, the form first calls `POST /api/agents/embedding-check`, which performs one real embedding call using the selected model:

- **Failure** — the save is blocked and the provider's actual error is surfaced ("model not found", "no credentials"). The tenant learns immediately rather than discovering later that caching never engaged.
- **Success** — the measured `vector.length` is stored as `embeddingDims`.

This exists because the platform cannot assume tenants will select a working model, and because a silently inert feature generates support load.

## Agent configuration

```ts
// libs/agent-studio/src/types/agent.ts
semanticCache?: {
  enabled: boolean;         // default false
  embeddingModel: string;   // required when enabled
  threshold: number;        // bounded by the single threshold band
};
```

Stored in the existing `config` JSON column, so no migration is required for the agent side.

The threshold is exposed to tenants; the embedding model is exposed but validated at save time. The distinction is deliberate: a poor threshold degrades quality gradually and is reversible, while an unusable embedding model would break the feature — so the threshold is a bounded choice, and the model choice is verified before it can be persisted.

**The threshold is presented as three named points on one scale, not as a bare number.** A cosine similarity is not a quantity a tenant can reason about, so the form labels the scale Strict / Balanced / Loose. The presets are fixed points, identical for every model — `getPresetThreshold(embeddingModel, preset)`: `strict` → 0.95, `balanced` → 0.75, `loose` → 0.45. The `embeddingModel` argument is ignored; it stays in the signature so a per-model band can return without touching callers. Because a tenant can also land anywhere between the presets, `presetForThreshold(embeddingModel, value)` reports a **zone** rather than a nearest neighbour: `>= 0.95` is Strict, `< 0.6` is Loose, everything between is Balanced. A non-finite stored value reports Balanced.

The control is a shadcn `Slider` over the band under the label **Match strictness**, with the three presets as clickable markers at their real positions and the current zone label and number shown alongside, so the value stays inspectable and tunable:

> **Strict** — Only near-identical wording.
> **Balanced** — Recommended.
> **Loose** — More hits, more risk of a wrong answer.

The read-only agent card shows the same pairing — `Balanced (0.75)`.

The stored config is unchanged: `threshold: number`, exactly as before. The preset name is never persisted. This keeps the whole server path — `sanitiseThreshold`, the SQL comparison, the near-miss logs — working on the same field, lets an agent saved before the presets existed load into the zone it falls in, and means the band can be retuned without a data migration. Changing the embedding model leaves the stored number alone — the band does not move with it.

### One band for every model, and what that costs

There is one band for every embedding model — `{ min: 0.45, default: 0.75, max: 0.99 }` from `getThresholdBand()` in `libs/shared/src/services/semantic-cache-thresholds.ts` — and `sanitiseThreshold(value, embeddingModel)` clamps a persisted threshold against it, falling back to 0.75. This is a product decision: tenants tune the number themselves against their own traffic rather than the platform guessing per model.

| | min | default (Balanced) | max |
|---|---|---|---|
| Every embedding model | 0.45 | 0.75 | 0.99 |

Which resolve to these presets, the same for every model:

| Preset | Value |
|---|---|
| Strict | 0.95 |
| Balanced | 0.75 |
| Loose | 0.45 |

**Cosine similarity is not comparable across embedding families, and one band does not make it so.** The measurements below are the evidence: on `amazon.titan-embed-text-v2:0` true paraphrases sit around 0.50, while OpenAI-family models put the same kind of pair in the 0.9x band. The 0.75 default is deliberately mid-scale and **will rarely produce a hit on Titan** — an agent on a Titan model needs to be moved toward Loose, using the near-miss logs as the evidence for where to stop. The 0.45 floor exists precisely because that is where Titan's real matches live.

**Measured against real `amazon.titan-embed-text-v2:0` embeddings, cosine similarity:**

True paraphrases — should hit:

| Similarity | Pair |
|---|---|
| 0.5288 | "how do I reset my password" / "I need to reset my password" |
| 0.4959 | "how do I reset my password" / "how can I reset the password" |
| 0.4951 | "what are your business hours" / "when are you open" |
| 0.9686 | "how much does the pro plan cost" / "what is the price of the pro plan" |

Different meaning — must not hit:

| Similarity | Pair |
|---|---|
| 0.2817 | "how do I reset my password" / "how do I change my email" |
| 0.8122 | "show me revenue for Q3" / "show me revenue for Q4" |
| 0.3841 | "how do I cancel my subscription" / "how do I upgrade my subscription" |
| 0.0145 | "what are your business hours" / "what is your refund policy" |
| 0.8638 | "is the API rate limited" / "is the API **not** rate limited" |

**Read naively, the two classes overlap between 0.4951 and 0.8638 and no threshold separates them** — a true paraphrase scores 0.4951 while a semantic opposite scores 0.8638. That reading is what produced the original 0.88/0.93/0.99 band, and it was measured before the guards existed.

**The guards remove both offenders from the comparison.** The negation guard rejects "is the API rate limited" / "is the API **not** rate limited" (0.8638) and the numeric guard rejects "show me revenue for Q3" / "Q4" (0.8122) regardless of similarity, so neither pair can be served at any threshold. What the threshold must separate is therefore only the *unguarded* pairs: the highest non-match is **0.3841** ("cancel my subscription" / "upgrade my subscription") and the lowest true paraphrase is **0.4951**. Those do not overlap, and the floor belongs between them — at 0.45, not 0.88.

The old 0.88 floor could never reach the 0.49–0.53 zone where the measured Titan paraphrases actually live, which made the feature inert on Titan: it was configured to a range no real match could enter. The 0.45 floor is what lets a Titan agent be tuned into that zone at all.

**The margin is ~0.11 across only 9 measured pairs.** That is thin evidence for a number the cache's correctness rests on, and it is a fixture, not traffic. The band should be retuned from near-miss logs once real traffic exists; until then the numeric and negation guards, not the threshold, are what stand between the cache and a confidently wrong answer.

An earlier configuration — a single global 0.90/0.97/0.99 — produced **zero hits ever** with Titan, since the highest measured paraphrase pair was 0.9686 and everything else sat far below. The band's floor at 0.45 is the fix for that; the 0.75 default is not, and is not meant to be.

**No default in the band is validated on any model other than Titan v2.** The 0.9x numbers commonly quoted come from Azure API Management, Kong and pgEdge documentation, all of which assume OpenAI-family embeddings; nothing outside the Titan fixture has been measured on this platform. Any model should be measured, or tuned from its near-miss logs, before its threshold is trusted.

### Telling the tenant when caching will not apply

A tenant who enables semantic caching on an agent that has tools attached will see no effect at all, draw the obvious wrong conclusion, and open a support ticket. The eligibility rules must therefore be visible at the point of decision rather than buried in documentation.

**The copy must not reverse the causality.** Enabling the cache does not disable tools. Having tools means the cache never engages. Wording that implies the former would make tenants believe the toggle breaks their agent.

**Always shown while the toggle is on** — a muted note under the strictness presets:

> Answers are only reused for one-off questions. This agent will not reuse an answer when it uses tools, when the request is part of an ongoing conversation, or when the caller asks for a fresh answer.

**Shown additionally when the agent has tools attached** — a `variant="destructive"` `Alert`:

> **Nothing will be cached while tools are attached.**
> Tools fetch live data and can perform actions such as creating a ticket. Reusing a saved answer would skip them entirely, so this agent's responses are never cached. Caching applies to agents that answer from their own knowledge.

The toggle stays enabled rather than being disabled in this state: tools may be removed later, and a control that cannot be operated with no explanation is worse than one with a warning.

**Detecting "has tools" needs both sources.** `config.tools` covers built-in tools and is already passed to the form. MCP servers are a separate relation fetched independently by `McpServersTab`, so the form cannot see them. The form takes an optional `attachedToolCount` prop that the edit page computes from both; when the MCP count is unavailable the static note still covers the case. Confirming how the edit page obtains the MCP attachment count is an implementation task, not an assumption of this design.

The same eligibility summary belongs on the read-only config card, so someone reviewing an agent sees why a cache they enabled is reporting no hits.

## Request flow

Within `POST /api/v1/inference`, for simple agents:

1. **Tier 1 — exact.** Unchanged. On hit, return with `cacheHit: true, cacheType: 'exact'`.
2. **Tier 2 — semantic.** Only if [eligible](#eligibility):
   a. Embed **the last user message only**. Embedding the whole message array makes every request unique and produces a near-zero hit rate.
   b. Query:
      ```sql
      SELECT id, response, prompt_text,
             1 - (embedding <=> $1::vector) AS similarity
      FROM llm_semantic_cache
      WHERE scope_key = $2 AND expires_at > now()
      ORDER BY embedding <=> $1::vector
      LIMIT 1
      ```
      This mirrors the established pattern at `libs/knowledge-base/src/repositories/document-chunk/postgres.ts:123`.
   c. Accept the row only if `similarity >= threshold` **and** both the [numeric guard](#the-numeric-guard) and the [negation guard](#the-negation-guard) pass. On acceptance, increment `hitCount` and return with `cacheHit: true, cacheType: 'semantic'`.
3. **Miss.** Call the LLM as normal, then write to **both** tiers.

Both tiers use the same expiry, resolved by the existing precedence: request `cacheTtlMinutes`, then the agent's `cacheTtlMinutes`, then the 1440-minute default. A semantic entry never outlives the exact entry written from the same response, so `cacheTtlMinutes: 0` disables both tiers and there is no second TTL setting for tenants to reason about.

Ordering matters: tier 1 is free, while tier 2 costs an embedding call (roughly 50–150ms plus token cost) before it can even determine whether there is a hit. Consulting the semantic tier first would tax every request that the exact tier could have served for nothing.

### Response contract

`cacheHit: boolean` keeps its current meaning and type. A new `cacheType: 'exact' | 'semantic'` field is added, present only on hits. Existing integrations are unaffected.

`ApiKeyExecution` gains a nullable `cacheType String?` column so the inferences dashboard can distinguish the two hit types. This is an additive migration.

### The numeric guard

After a candidate passes the similarity threshold, extract all digit sequences (`/\d+/g`) from the incoming prompt and from the stored `promptText`, preserving order. If the two ordered lists are not identical, treat the candidate as a miss.

Ordered comparison, not set comparison: "transfer 500 to 200" and "transfer 200 to 500" contain the same digits and must not match each other.

This targets the highest-risk class of false positive: "Q3 revenue" vs "Q4 revenue", "order 12345" vs "order 12346", "invoice for March 2025" vs "March 2026". These produce confidently wrong answers — "show me revenue for Q3" vs "Q4" measures 0.8122 on Titan, higher than three of the four true paraphrases. No threshold setting can separate them, because they are genuinely near-identical in embedding space. A digit comparison separates all of them.

### The negation guard

Count negation markers in the incoming prompt and in the stored `promptText`. If the counts differ, treat the candidate as a miss. Markers, matched on word boundaries and case-insensitively: `not`, the `n't` suffix (so `isn't`, `doesn't`, `won't` all count), `no`, `never`, `without`, `cannot`, `can't`, `unable`.

This exists because negation inverts meaning while barely moving the vector. "is the API rate limited" vs "is the API **not** rate limited" measured **0.8638** — the highest-scoring non-match in the set, above every paraphrase except one, and the single most dangerous failure the cache can produce: a confident answer that is the exact opposite of the truth. Like the numeric guard, no threshold catches it; unlike the numeric guard, it is a class the industry implementations in the table below do not address at all.

The comparison is a count, not a position: two prompts that both negate ("is the API not rate limited" / "isn't the API rate limited") still match, and the guard rejects only asymmetric negation. It over-rejects in principle (a double negative reads as two markers), which is the correct direction to be wrong in.

### Failure handling

The semantic tier **fails open** without exception. Embedding error, embedding timeout, unexpected vector length, or a database error on the vector query: log at `warn` with structured context and proceed to the LLM call. A cache tier being unavailable must never surface to the caller as an error.

Two guards apply to **both** tiers:

- Never store an empty or whitespace-only response.
- Never store when the LLM call errored.

These fix an existing defect where a failed provider call is recorded as `completed` with `text: ""` and cached. In tier 1 that poisons one key; in tier 2 a single blank row would answer an entire neighbourhood of prompts.

## Observability

Every semantic hit logs at `info` with both prompts side by side:

```ts
logger.info({
  tenantId, agentId, cacheEntryId,
  similarity: 0.981, threshold: 0.75,
  promptText: 'how do I reset my password',
  cachedPromptText: 'how can I reset the password',
}, 'Semantic cache hit');
```

This is not optional instrumentation — it is the only way to distinguish a good hit from a bad one after the fact. The documented industry failure mode is that nothing logs a false-positive hit, so quality degrades invisibly.

Near-misses — candidates scoring within 0.05 below the threshold — log at `debug`. This is the dataset a tenant tunes their threshold from, replacing guesswork with evidence. It carries more weight now that one band serves every model: the floor rests on a ~0.11 margin over 9 fixture pairs, and for any model other than Titan v2 this log is the only evidence of where its two distributions actually sit.

Rejections by the numeric guard and by the negation guard log at `debug` with both prompts, so each guard's own false-rejection rate is measurable.

`sanitiseThreshold` logs at `warn` with the model id, the band and the fallback value when a persisted threshold falls outside the band — the signal that an agent holds a threshold no longer in range.

## Kill switches

In order of blast radius:

1. `SEMANTIC_CACHE_ENABLED` — T3 env var, platform-wide, no tenant data touched.
2. `semanticCache.enabled` — per agent.
3. `noCache: true` — per request; already bypasses both tiers.

## Cleanup

`ResponseCacheService.cleanupExpired()` currently has no caller, so `llm_response_cache` grows without bound. A worker job runs cleanup for **both** tables on a schedule.

For the semantic table this is a performance requirement rather than housekeeping: with no vector index, lookup cost is linear in the number of live rows per scope, so accumulated expired rows directly slow down every lookup.

## Code structure

| Unit | Responsibility |
|---|---|
| `libs/shared/src/services/semantic-cache-service.ts` | New. `buildScopeKey()`, `lookup()`, `store()`, `cleanupExpired()`. Owns the raw SQL, the numeric guard and the negation guard. Takes an injected db, mirroring `ResponseCacheService` so it unit-tests the same way. |
| `libs/shared/src/services/semantic-cache-thresholds.ts` | New. The single threshold band, `getThresholdBand()`, and the preset mapping `getPresetThreshold()` / `presetForThreshold()`. Kept free of server-only imports so `@chatbot/shared/client` can re-export it to the agent form. |
| `libs/shared/src/services/response-cache-service.ts` | Unchanged except the empty-response guard. |
| `apps/web-ui/app/api/v1/inference/route.ts` | Orchestration only: tier 1, tier 2, LLM, write both. |
| `apps/web-ui/app/api/agents/embedding-check/route.ts` | New. Validates an embedding model with one live call, returns measured dimensions. |
| `libs/agent-studio/src/types/agent.ts` | `semanticCache` on `SimpleAgentConfig`. |
| `apps/web-ui/components/agents/config/simple-agent-form.tsx` | Switch, `ProviderModelSelect capability="embedding"`, and a **Match strictness** slider over the band with Strict/Balanced/Loose markers, shown only once an embedding model is selected. |
| `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx` | Read-only display of the semantic cache settings, showing the preset name with its number. |
| Worker job | Scheduled `cleanupExpired()` for both cache tables. |

## Testing

**Unit** — `semantic-cache-service.test.ts` with an injected fake db, following the pattern of `response-cache-service.test.ts`: scope-key composition including `embeddingModel`, threshold comparison at boundaries, the numeric guard and the negation guard (accept and reject cases, including the measured "is the API rate limited" / "is the API not rate limited" pair), band resolution and threshold clamping, the preset mapping in both directions (including the round trip value → preset → value, the zone boundaries, and a stored value from outside the band), the `expiresAt > now()` predicate, `hitCount` increment, and fail-open behaviour when the db throws.

**Integration against real PostgreSQL** — the SQL cannot be meaningfully mocked, and the highest-risk defects live in it. A vitest file guarded by an env check so it skips during normal `nx test`, run against the local docker Postgres:

- mixed-dimension rows coexisting in the dimensionless column;
- **scope isolation** — agent A's rows are never returned for agent B's lookup (the multi-tenant safety property);
- expired rows excluded from lookups;
- similarity values correct for a known pair of vectors.

**Live verification** — real API calls through a throwaway agent confirming exact hit, semantic hit and miss, with similarity scores read from the logs.

## Rollout

1. Ship with the feature off for every agent.
2. Enable on one internal agent.
3. Read a week of hit and near-miss logs.
4. Decide where that agent's threshold should sit — on Titan, expect to move it toward Loose — and whether to promote the feature more widely.
5. Measure any embedding model other than Titan v2 before enabling it, using the paraphrase/non-match pairs above as the fixture.

## Deferred work

**Volatile-query classification.** Prompts like "what is the current status", "today's numbers", or "my order status" produce stable embeddings with changing correct answers, so a cache will serve a stale answer indefinitely. The mitigation is a regex or LLM pre-classifier in the application layer that bypasses the cache for such prompts. It is deferred because it is a feature with its own design, not a detail of this one. v1 relies on per-agent opt-in, a deliberately mid-scale default threshold and short TTLs. **This should be owned before semantic caching is enabled by default for any tenant.**

**Per-tenant dimension redesign for the knowledge base.** Out of scope here, but this design should not be read as having solved it. The KB's `vector(1024)` column versus configurable `embeddingDimensions` remains an open defect.

## Industry practice

Semantic caching is an established pattern with shipped, documented implementations, not a novel technique. This section records what comparable systems do, so the choices above can be judged against prior art rather than taken on faith.

### What comparable systems ship

| System | Store | Scope partitioning | Multi-turn handling | Threshold default |
|---|---|---|---|---|
| Azure API Management | Azure Managed Redis / RediSearch | `vary-by` expression, docs recommend user or user-group identifiers | `max-message-count` — caching skipped past N dialog messages | `score-threshold` 0.05 **as distance** (see note) |
| LiteLLM | Redis, Qdrant, or Valkey | Per-deployment collection | Documented as unsupported; exact-match recommended for agentic traffic | `similarity_threshold` ≈ 0.8 |
| Kong AI Gateway | Redis or other vector store | Plugin scope (service / route / consumer) | Not documented | Configurable |
| pgEdge `pg_semantic_cache` | PostgreSQL + pgvector | None — single global pool, tags only | Not addressed | `similarity_threshold` 0.95 |
| **This design** | PostgreSQL + pgvector | `scopeKey` — agent version, prompt, model, temperature, embedding model | Excluded entirely via `!sessionId` | `threshold` — one band for every model, 0.75 default, tenant-tunable over 0.45–0.99 |

**Threshold semantics differ between products and must not be compared naively.** Azure's `score-threshold` is a *distance*: lower means stricter, their example uses 0.05, and their docs warn that values above 0.2 risk mismatches. That 0.05 distance corresponds to roughly 0.95 similarity — the same strictness as pgEdge's 0.95, expressed inversely. This design uses similarity, where higher is stricter.

**None of these defaults are transferable, including into this design.** Every number in the column was tuned against an embedding model the product's authors chose and mostly did not name. The Titan measurements above are why this design's band reaches down to 0.45: the 0.95–0.97 that is "slightly strict" for OpenAI-family embeddings is unreachable for Titan v2, so a tenant on Titan must be able to tune below it.

### Where this design agrees with prior art

- **Scope partitioning is standard.** Azure's `vary-by` exists for exactly the reason `scopeKey` does, and its documentation explicitly frames it as the control for cross-user cache access. Partitioning is not a precaution invented here.
- **The single-shot boundary is the industry consensus**, arrived at independently by LiteLLM (documented exclusion) and Azure (message-count cutoff).
- **Embeddings are always the caller's job.** No system in the table generates them internally.
- **Vendors warn about correctness in their own documentation.** Microsoft's policy reference states that because semantic caching returns responses based on similarity rather than exact match, it can surface responses that are incorrect, outdated, or unsafe for the current request, and directs users to evaluate carefully and include safeguards. This is the vendor's own language, not a critic's.

### Where this design deliberately diverges

- **Scope includes the system prompt rather than stripping it.** Azure's `ignore-system-messages` (which it recommends enabling) removes system messages before computing similarity, so the user's question dominates the match. This design achieves the same effect differently: the system prompt is hashed into `scopeKey` instead, so it never influences the vector, but a change to it still invalidates entries. Azure's approach makes the prompt irrelevant to matching; this one makes it a hard partition boundary.
- **A band that reaches far below every published default.** No product in the table lets its threshold go near 0.45. The measured Titan distributions show that a published default is only meaningful alongside the model it was tuned on, so the floor has to sit where Titan's real matches are, and the tenant moves the value.
- **Correctness is enforced by guards, not by a high threshold.** Every product listed relies on its similarity number alone, and so sets it high. Because the numeric and negation guards reject the two dangerous classes independently of similarity, a Titan agent can be tuned down toward 0.45 — far below every published figure — without accepting what those figures exist to reject.
- **The numeric and negation guards have no equivalent in any of these products.** They address failure classes that thresholds structurally cannot catch — and on the measured data, both classes score higher than most true paraphrases.
- **No approximate index.** Every product above assumes a vector index; this design's per-scope search space is small enough that exact brute-force scanning is both faster and more accurate. See [Why there is no HNSW index](#why-there-is-no-hnsw-index).

### Reported results, and how much to trust them

Measured production hit rates for semantic caching land around **20–45%** of traffic, against roughly 15–25% for exact matching alone; FAQ and support workloads with narrow vocabularies report higher. An AWS-published evaluation over 63,796 real chatbot queries reported 86% cost reduction and 88% latency improvement on cache hits at a tuned threshold; this is the most credible figure available because the sample is real and disclosed.

Vendor and content-marketing case studies claiming 84% hit rates or 95% cost reductions could not be traced to named organisations and should not be used for planning.

**Do not plan this feature against 20–45%.** Those figures assume a threshold that sits between the paraphrase and non-match distributions. The widened band can be tuned to sit there — all four measured Titan paraphrases clear 0.45, where under the old 0.93 exactly one did — so the feature is at least capable of firing now, which it was not before. At the 0.75 default it will not fire on Titan; that is a tuning step, not a defect. But the separation rests on 9 fixture pairs, and the fixture was built to be separable in a way real traffic is not. Treat the published range as an upper bound to test against, not a forecast; the [rollout](#rollout) measurement is what turns it into a number.

### Known attack surface

Published research describes key-collision attacks against LLM semantic caches, where an attacker crafts a prompt engineered to fall within the similarity threshold of a cached entry in order to retrieve a response intended for someone else. In a multi-tenant platform this is a data-isolation concern, not merely a quality one. `scopeKey` is the primary mitigation — a crafted prompt can only ever collide within the same agent version of the same tenant, never across tenants — and the band's floor — 0.45, above every measured Titan non-match that the guards do not already reject — bounds how far the collision space can be widened. Tuning down toward that floor does enlarge the space relative to 0.93, which is a further reason the `scopeKey` partition, not the threshold, is the isolation mechanism being relied on. This is a further reason not to adopt a globally-pooled cache design.

## Alternatives considered

**pgEdge `pg_semantic_cache`.** A PostgreSQL extension providing `cache_query()` / `get_cached_result()` over pgvector, with tags, LRU/LFU eviction and monitoring views. Rejected:

- It requires compiling C and `sudo make install` with filesystem access to the Postgres installation, so it cannot be installed on AWS RDS or Aurora. (The project's own docs contradict themselves here — the installation page states RDS is unsupported while the FAQ lists it as supported; the installation page is correct, as RDS only loads extensions from Amazon's approved list.)
- It is v0.1.0-beta4 from pgEdge Labs, self-described as subject to change without notice, with 8 GitHub stars and 0 forks at time of evaluation.
- It does not generate embeddings — that remains the application's job either way.
- It has no concept of a scope key. Its cache is a single global pool with tags as the only partitioning mechanism, which is the wrong default for a multi-tenant platform.

What it would have provided over this design is tags, eviction policies and monitoring views, in exchange for a C extension, a build step and a deployment constraint.

**Redis or Qdrant via LiteLLM's built-in semantic cache.** LiteLLM ships `redis-semantic`, `qdrant-semantic` and `valkey-semantic` cache modes, and the platform already proxies through LiteLLM for some tenants. Rejected because every backend requires infrastructure the platform does not run, and the stated constraint is PostgreSQL only.

**A fixed platform-wide embedding model.** Simpler schema, single dimension, HNSW available. Rejected because tenants without credentials for that provider would enable the feature and silently get nothing.
