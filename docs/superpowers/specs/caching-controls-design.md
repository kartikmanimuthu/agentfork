# Caching Controls Design

## Overview

Give tenants direct control over both cache tiers from a dedicated **Caching** tab, replace the implicit "TTL > 0 means caching is on" rule with explicit per-tier toggles, let the eligibility rules be overridden deliberately rather than silently enforced, and surface what the cache actually did on inference records.

Builds on [the semantic cache design](semantic-cache-design.md), which stays authoritative for how the semantic tier works internally — scope key, guards, thresholds, fail-open. Nothing in that mechanism changes here.

**Scope:** simple agents on the inference API (`POST /api/v1/inference`), the agent edit UI, and the inferences UI.

## Four changes

1. Caching configuration moves from the Configuration tab to its own **Caching** tab.
2. Prompt (exact) and semantic caching become two independent toggles with independent TTLs, expressed in **seconds**.
3. The eligibility conditions become per-agent override toggles, held **per tier**, all defaulting to off.
4. Inference records show which kind of cache hit occurred and how long the request actually took.

The exact tier is called **Prompt cache** everywhere a user can see it. The stored config
key (`caching.exact`), the request field (`exactCacheTtlSeconds`) and the recorded
`cacheType: 'exact'` keep their names — they are contract and stored data.

## Configuration

### Shape

```ts
caching?: {
  exact: {
    enabled: boolean;
    ttlSeconds: number;
    overrides: { withTools: boolean; inSessions: boolean };
  };
  semantic: {
    enabled: boolean;
    ttlSeconds: number;
    embeddingModel: string;
    threshold: number;
    overrides: {
      withTools: boolean;
      inSessions: boolean;
      withAttachments: boolean;
      withKnowledgeBase: boolean;
    };
  };
}
```

**Each tier owns its own overrides.** The two tiers fail differently — the prompt tier
misses on anything the hash covers, the semantic tier is blind to attachments and
retrieved context — so a tenant who accepts one tier's risk has not accepted the
other's. One shared set forced that decision to be made once for both.

**One `withTools` flag, not two.** MCP tools and built-in tools were separate toggles.
A cached answer means the tool never ran, whichever kind it was: same failure, so one
toggle. Configs carrying the old pair are read as `withMcpTools || withBuiltInTools`.

`withAttachments` and `withKnowledgeBase` exist on the semantic tier **only** — see
[why](#why-two-overrides-apply-to-the-semantic-tier-only) below.

Stored in the existing agent `config` JSON column. No Prisma migration.

Both `ttlSeconds` fields accept `0`–`604800` (7 days), matching the 10080-minute ceiling the exact tier enforces today. `0` disables that tier, exactly as `cacheTtlMinutes: 0` does now.

Defaults for a new agent: **both tiers disabled**, every override on both tiers `false`.
`ttlSeconds` still resolves to `86400` so the UI has a sensible number to show the moment
a tier is switched on, but nothing is cached until someone enables it.

A config carrying an explicit `cacheTtlMinutes` keeps caching — that value was a decision
someone made. Only agents that were never configured come out off, so deploying this
changes no existing agent's behaviour.

### Reading older configs

Agents configured before this change carry `cacheTtlMinutes` and `semanticCache`, or the earlier shared-overrides shape. A single normaliser handles all of them:

```ts
resolveCachingConfig(simpleConfig): ResolvedCaching
```

in `libs/shared/src/services/caching-config.ts`. It handles three input shapes:

1. **Per-tier** (current) — `caching.exact.overrides` / `caching.semantic.overrides` present. Used as-is.
2. **Shared overrides** — `caching.overrides` with the five old keys. Mapped onto both tiers: `withTools = withMcpTools || withBuiltInTools`, `inSessions` carried to both, `withAttachments` / `withKnowledgeBase` to the semantic tier only. A per-tier set present alongside a leftover shared set wins.
3. **Legacy** — `cacheTtlMinutes` / `semanticCache`, with:
   - `exact.enabled` = `(cacheTtlMinutes ?? 1440) > 0`
   - `exact.ttlSeconds` = `(cacheTtlMinutes ?? 1440) * 60`
   - `semantic` = the old `semanticCache` object, with `ttlSeconds` set to the same derived value
   - every override on both tiers = `false`

Shapes 2 and 3 exist so that restructuring the overrides changes no existing agent's
behaviour. Each has its own unit test, including the OR-merge of the two tool flags.

Both the route and the UI call this function, so the two can never disagree about what an old config means. The ×60 conversion lives in exactly one place — a TTL that silently becomes 60× shorter is the obvious failure here, and one function is the way to keep it testable.

No backfill migration. Old configs are normalised on read and rewritten in the new shape the next time an agent is saved.

### Why seconds

Requested. Minutes was too coarse for testing short-lived caches, and seconds matches how the underlying `expiresAt` is computed anyway.

## Eligibility

### The rule

Each tier is evaluated against **its own** overrides, and each returns its own blocker
list so the log says why that tier in particular was skipped.

```
hasTools = hasMcpTools || hasBuiltInTools

// TTLs below are the RESOLVED values: request field → agent config → default.
exactEnabled = !noCache
            && caching.exact.enabled
            && exactTtlSeconds > 0
            && (!hasTools   || caching.exact.overrides.withTools)
            && (!sessionId  || caching.exact.overrides.inSessions)

semanticEnabled = !noCache
               && caching.semantic.enabled
               && semanticTtlSeconds > 0
               && caching.semantic.embeddingModel
               && env.SEMANTIC_CACHE_ENABLED
               && (!hasTools          || caching.semantic.overrides.withTools)
               && (!sessionId         || caching.semantic.overrides.inSessions)
               && (!hasNonTextContent || caching.semantic.overrides.withAttachments)
               && (!hasKbContext      || caching.semantic.overrides.withKnowledgeBase)
```

`computeCacheEligibility` returns `exactBlockers` and `semanticBlockers` rather than one
shared `blockers` array: with per-tier overrides a single list can no longer say which
tier a condition stopped. Blocker names: `no_cache`, `tools`, `session`, plus
`attachments`, `kb_context`, `no_embedding_model` and `kill_switch` on the semantic side.

`noCache: true` on the request is absolute and cannot be overridden by configuration — it is the caller explicitly asking for a fresh answer.

### Why two overrides apply to the semantic tier only

`withAttachments` and `withKnowledgeBase` gate the semantic tier alone. This is not an oversight.

The prompt (exact) tier hashes the **whole** `coreMessages` array, image parts included, and the **full** system prompt with retrieved knowledge-base context already appended. A different attachment or different retrieved context therefore produces a different hash and correctly misses. The exact tier needs no guard because it cannot make that mistake.

Verified in the current route rather than assumed: `route.ts:504` appends `kbContext` to `effectiveSystem`, and `route.ts:508-513` builds the exact key from that same `effectiveSystem` plus `coreMessages`. The semantic scope key deliberately uses `baseSystem` instead (`route.ts:643-645`), which is precisely why it is blind to retrieved context.

The semantic tier embeds the last user message as text. It cannot see an attachment and never sees the retrieved context, so identical wording with a different invoice, or the same question against different retrieved passages, matches at high similarity and returns the wrong answer. Those two guards exist for that failure, and belong with the tier that has it.

The UI reflects this: those two toggles exist only in the semantic tier's Advanced group, and the config shape has no place to store them on the prompt tier.

### Tier independence

Any combination of the two toggles is valid:

| Prompt | Semantic | Behaviour |
|---|---|---|
| on | on | prompt first; on a miss, semantic |
| on | off | hash matching only |
| off | on | vector matching only |
| off | off | no caching |

**Semantic-only is intentionally offered although it is the weakest combination.** With the prompt tier off, a repeated identical question still matches semantically at similarity 1.0 — so the tier is not avoided, it is simply reached by paying an embedding call for a lookup a free hash would have served. Recorded here so nobody later reads it as an oversight; it was a product decision.

## API contract

Breaking change, taken deliberately because the feature has not been deployed and has no callers.

**Removed:** `cacheTtlMinutes`.

**Added:**

```ts
exactCacheTtlSeconds?:    number  // 0–604800
semanticCacheTtlSeconds?: number  // 0–604800
```

Precedence per tier, unchanged in structure: request value → agent config → default.

`noCache` is unchanged. The response keeps `cacheHit: boolean` and `cacheType: 'exact' | 'semantic'`.

## The Caching tab

A new tab beside Configuration, Knowledge Bases, MCP Servers, Tools, Channels, Versions and API Keys, rendered from `apps/web-ui/components/agents/tabs/caching-tab.tsx`.

Two cards, one per tier. Each tier's inner controls render only when that tier's toggle
is on, and each card ends with its **own** Advanced group — there is no shared Advanced
block, because an override belongs to the tier whose risk it accepts.

**Prompt cache** — toggle, TTL in seconds, Advanced. Helper text: "Reuses an answer only when the question is byte-identical."

**Semantic cache** — toggle, embedding model picker, match-strictness slider with its preset markers (still hidden until an embedding model is chosen), TTL in seconds, the eligibility summary, Advanced.

| Tier | Advanced toggles |
|---|---|
| Prompt cache | Tools, Conversations |
| Semantic cache | Tools, Conversations, Attachments, Knowledge base (RAG) |

Every toggle is off by default and states what it costs:

| Toggle | Warning shown when enabled |
|---|---|
| Tools | **The tool never runs.** An answer saying a ticket was created will replay with no ticket created, and web search will not run. |
| Conversations | **Turns in a conversation look nearly identical.** An earlier turn's answer can be replayed for a later, different question. |
| Attachments *(semantic only)* | **Attachments are not part of the semantic match.** The same question with a different file can return the earlier file's answer. |
| Knowledge base (RAG) *(semantic only)* | **Retrieved context is not part of the semantic match.** The stored answer was grounded in different context than the current question. |

Each warning renders as a `variant="destructive"` Alert when its toggle is on, not as static helper text. Turning one on is a decision with a real failure mode and should look like one.

The Configuration tab loses the TTL field and the semantic block, returning to model, system prompt, temperature and max tokens.

## Observability

### Latency on cache hits

Cache-hit paths currently write `cacheType` and `completedAt` but never `latencyMs`, so the metric that demonstrates the feature works reads as null. All hit paths set `latencyMs = Date.now() - startedAt`, the same way miss paths already do.

### The eligibility log

The route logs the eligibility decision with both blocker lists, both override sets and
both resolved TTLs. It logs at **info** when a tier is enabled in config but blocked at
request time, and at **debug** otherwise.

The asymmetry is deliberate. Nonprod runs at info level, so a debug-only line turned a
one-grep diagnosis ("why did the cache this tenant switched on never fire?") into a long
CloudWatch hunt. A tier nobody configured produces nothing worth reading, so quiet agents
stay at debug.

### Inferences list

`apps/web-ui/app/(dashboard)/inferences/page.tsx` gains a **Cache** column rendering `Hit · Prompt`, `Hit · Semantic`, or `—`. The stored `cacheType` value stays `'exact'`; only the label reads "Prompt".

The existing cache filter (all / hit / miss) becomes all / prompt / semantic / miss. The list API must return `cacheType` and accept it as a filter.

### Inference detail

The metrics block shows the cache type beside latency, so a 4 ms request is legible as a semantic hit rather than an unexplained outlier.

The `cacheHitRate` stat tile stays as is. Splitting it by tier is deferred until there is traffic worth splitting.

## Code structure

| Unit | Responsibility |
|---|---|
| `libs/shared/src/services/caching-config.ts` | New. `resolveCachingConfig()` plus its types. Pure, no server imports, so the Caching tab can import it through `@chatbot/shared/client`. |
| `libs/agent-studio/src/types/agent.ts` | `caching` on `SimpleAgentConfig`; the old `cacheTtlMinutes` and `semanticCache` stay declared as deprecated inputs to the normaliser. |
| `libs/shared/src/services/cache-eligibility.ts` | `computeCacheEligibility()`. Per-tier overrides in, per-tier blocker lists out. |
| `apps/web-ui/app/api/v1/inference/route.ts` | New request fields, eligibility computed from the resolved config, per-tier TTLs, latency on hits, the eligibility log. |
| `apps/web-ui/components/agents/tabs/caching-tab.tsx` | New. The whole tab. |
| `apps/web-ui/components/agents/config/simple-agent-form.tsx` | Caching controls removed. |
| `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx` | Registers the tab. |
| `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx` | Read-only caching summary reads the resolved config. |
| `apps/web-ui/app/(dashboard)/inferences/page.tsx` + list API | Cache column and filter. |
| `apps/web-ui/components/inferences/inference-metrics.tsx` | Cache type beside latency. |

## Testing

**Unit — `resolveCachingConfig`.** All three input shapes: per-tier passthrough; shared-overrides mapping onto both tiers including the `withMcpTools || withBuiltInTools` merge; legacy derivation including the ×60 conversion and `cacheTtlMinutes: 0` deriving to the prompt tier disabled. Plus: absent config yielding the documented defaults, every override defaulting to false, and the prompt tier never carrying `withAttachments` / `withKnowledgeBase`.

**Unit — the eligibility matrix.** Conditions against override on/off across both tiers is where a hand-written boolean chain goes wrong, so it gets a table-driven test rather than a handful of examples. It must assert explicitly that `withAttachments` and `withKnowledgeBase` do **not** affect the prompt tier, that either tier can be blocked while the other is not (each tier honours only its own overrides), and that `noCache` beats every override.

**Live.** Walk the four tier combinations; confirm a tools-attached agent caches nothing until the override is on and does once it is; confirm the inferences list shows the right cache type; confirm latency on a hit is milliseconds rather than null.

## Out of scope

- Per-request override of the eligibility toggles. Per-agent only, as decided.
- Splitting the cache-hit-rate statistic by tier.
- Chat channels and the playground; the inference API remains the only surface.
- Everything already deferred by the semantic cache design, notably volatile-query classification.
