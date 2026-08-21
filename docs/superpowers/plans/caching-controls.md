# Caching Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tenants explicit per-tier cache toggles with independent TTLs in seconds, a dedicated Caching tab, per-agent overrides for the five eligibility conditions, and cache visibility on inference records.

**Architecture:** A single `caching` object on the agent config replaces `cacheTtlMinutes` and `semanticCache`. One pure normaliser, `resolveCachingConfig()`, reads both the new and old shapes so the route and the UI can never disagree. The route computes per-tier eligibility from that resolved config instead of a hard-coded boolean chain.

**Tech Stack:** TypeScript, Bun + Nx monorepo, Next.js 15 App Router, TanStack Form, shadcn/ui, Vitest, Prisma 6, PostgreSQL 16 + pgvector.

**Spec:** `docs/superpowers/specs/caching-controls-design.md`

## Global Constraints

- TTLs are **seconds**, range `0`–`604800` (7 days). `0` disables that tier. No value anywhere in new code is in minutes.
- `cacheTtlMinutes` is **removed** from the public API request schema. The feature is undeployed and has no callers, so no deprecation shim.
- Old stored configs are read through `resolveCachingConfig()` only. The `× 60` conversion appears in exactly ONE place in the codebase.
- All five overrides default to `false`, which reproduces today's behaviour exactly.
- `noCache: true` on a request is absolute and cannot be overridden by any config.
- `withAttachments` and `withKnowledgeBase` gate the **semantic tier only** — the exact tier already hashes attachments and KB context (`route.ts:504`, `route.ts:508-513`), so it cannot make that mistake.
- The semantic tier fails open: any error logs at `warn` and falls through to the LLM, never a non-2xx.
- Pino structured logging with context objects, never bare strings. TypeScript strict. All UI uses shadcn/ui components. Zod validation at every boundary.
- `bunx` not `npx`. Never `process.env` directly — use T3 env.

---

### Task 1: `resolveCachingConfig` — the normaliser

Pure function, no DB, no server imports. Everything else depends on it, so it goes first and gets the heaviest test coverage.

**Files:**
- Create: `libs/shared/src/services/caching-config.ts`
- Create: `libs/shared/src/services/caching-config.test.ts`
- Modify: `libs/shared/src/client.ts` (export block — it already exports `./services/semantic-cache-thresholds`, follow that pattern)
- Modify: `libs/shared/src/index.ts` (export block)

**Interfaces:**
- Consumes: `getThresholdBand`, `DEFAULT_SIMILARITY_THRESHOLD` from `./semantic-cache-thresholds`.
- Produces:
  - `interface CacheOverrides { withMcpTools: boolean; withBuiltInTools: boolean; inSessions: boolean; withAttachments: boolean; withKnowledgeBase: boolean }`
  - `interface ResolvedCaching { exact: { enabled: boolean; ttlSeconds: number }; semantic: { enabled: boolean; ttlSeconds: number; embeddingModel: string; threshold: number }; overrides: CacheOverrides }`
  - `resolveCachingConfig(config: unknown): ResolvedCaching`
  - `DEFAULT_CACHE_TTL_SECONDS = 86400`, `MAX_CACHE_TTL_SECONDS = 604800`

- [ ] **Step 1: Write the failing test**

```ts
// libs/shared/src/services/caching-config.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveCachingConfig,
  DEFAULT_CACHE_TTL_SECONDS,
  MAX_CACHE_TTL_SECONDS,
} from './caching-config';

const NO_OVERRIDES = {
  withMcpTools: false,
  withBuiltInTools: false,
  inSessions: false,
  withAttachments: false,
  withKnowledgeBase: false,
};

describe('resolveCachingConfig', () => {
  describe('defaults', () => {
    it('enables the exact tier at 24h and disables semantic when there is no config', () => {
      const r = resolveCachingConfig({});
      expect(r.exact).toEqual({ enabled: true, ttlSeconds: DEFAULT_CACHE_TTL_SECONDS });
      expect(r.semantic.enabled).toBe(false);
      expect(r.overrides).toEqual(NO_OVERRIDES);
    });

    it('exposes the documented constants', () => {
      expect(DEFAULT_CACHE_TTL_SECONDS).toBe(86400);
      expect(MAX_CACHE_TTL_SECONDS).toBe(604800);
    });

    it('tolerates null and undefined', () => {
      expect(resolveCachingConfig(null).exact.enabled).toBe(true);
      expect(resolveCachingConfig(undefined).overrides).toEqual(NO_OVERRIDES);
    });
  });

  describe('new shape', () => {
    it('passes a full caching object through', () => {
      const r = resolveCachingConfig({
        caching: {
          exact: { enabled: false, ttlSeconds: 30 },
          semantic: { enabled: true, ttlSeconds: 120, embeddingModel: 'm', threshold: 0.6 },
          overrides: { ...NO_OVERRIDES, inSessions: true },
        },
      });
      expect(r.exact).toEqual({ enabled: false, ttlSeconds: 30 });
      expect(r.semantic).toEqual({ enabled: true, ttlSeconds: 120, embeddingModel: 'm', threshold: 0.6 });
      expect(r.overrides.inSessions).toBe(true);
      expect(r.overrides.withMcpTools).toBe(false);
    });

    it('fills missing overrides with false rather than dropping them', () => {
      const r = resolveCachingConfig({
        caching: { exact: { enabled: true, ttlSeconds: 60 }, overrides: { withMcpTools: true } },
      });
      expect(r.overrides).toEqual({ ...NO_OVERRIDES, withMcpTools: true });
    });

    it('clamps a ttl above the maximum and rejects a negative one', () => {
      expect(resolveCachingConfig({ caching: { exact: { enabled: true, ttlSeconds: 999999 } } }).exact.ttlSeconds)
        .toBe(MAX_CACHE_TTL_SECONDS);
      expect(resolveCachingConfig({ caching: { exact: { enabled: true, ttlSeconds: -5 } } }).exact.ttlSeconds)
        .toBe(0);
    });
  });

  describe('old shape', () => {
    it('converts cacheTtlMinutes to seconds exactly once', () => {
      const r = resolveCachingConfig({ cacheTtlMinutes: 60 });
      expect(r.exact.ttlSeconds).toBe(3600);
      expect(r.exact.enabled).toBe(true);
    });

    it('treats cacheTtlMinutes 0 as the exact tier disabled', () => {
      const r = resolveCachingConfig({ cacheTtlMinutes: 0 });
      expect(r.exact.enabled).toBe(false);
      expect(r.exact.ttlSeconds).toBe(0);
    });

    it('carries the old semanticCache across and gives it the same ttl', () => {
      const r = resolveCachingConfig({
        cacheTtlMinutes: 10,
        semanticCache: { enabled: true, embeddingModel: 'titan-embed', threshold: 0.5 },
      });
      expect(r.semantic.enabled).toBe(true);
      expect(r.semantic.embeddingModel).toBe('titan-embed');
      expect(r.semantic.threshold).toBe(0.5);
      expect(r.semantic.ttlSeconds).toBe(600);
    });

    it('defaults every override to false for an old config', () => {
      const r = resolveCachingConfig({ cacheTtlMinutes: 10, semanticCache: { enabled: true } });
      expect(r.overrides).toEqual(NO_OVERRIDES);
    });

    it('prefers the new shape when both are present', () => {
      const r = resolveCachingConfig({
        cacheTtlMinutes: 999,
        caching: { exact: { enabled: true, ttlSeconds: 42 } },
      });
      expect(r.exact.ttlSeconds).toBe(42);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/caching-config.test.ts`
Expected: FAIL — `Failed to resolve import "./caching-config"`

- [ ] **Step 3: Write the implementation**

```ts
// libs/shared/src/services/caching-config.ts
// Pure and free of server-only imports so the Caching tab can import it via
// `@chatbot/shared/client`.
import { getThresholdBand } from './semantic-cache-thresholds';

export const DEFAULT_CACHE_TTL_SECONDS = 86400;
export const MAX_CACHE_TTL_SECONDS = 604800;

export interface CacheOverrides {
  withMcpTools: boolean;
  withBuiltInTools: boolean;
  inSessions: boolean;
  withAttachments: boolean;
  withKnowledgeBase: boolean;
}

export interface ResolvedCaching {
  exact: { enabled: boolean; ttlSeconds: number };
  semantic: { enabled: boolean; ttlSeconds: number; embeddingModel: string; threshold: number };
  overrides: CacheOverrides;
}

const NO_OVERRIDES: CacheOverrides = {
  withMcpTools: false,
  withBuiltInTools: false,
  inSessions: false,
  withAttachments: false,
  withKnowledgeBase: false,
};

function clampTtl(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  return Math.min(Math.round(value), MAX_CACHE_TTL_SECONDS);
}

function readOverrides(raw: unknown): CacheOverrides {
  const o = (raw ?? {}) as Partial<CacheOverrides>;
  return {
    withMcpTools: o.withMcpTools === true,
    withBuiltInTools: o.withBuiltInTools === true,
    inSessions: o.inSessions === true,
    withAttachments: o.withAttachments === true,
    withKnowledgeBase: o.withKnowledgeBase === true,
  };
}

export function resolveCachingConfig(config: unknown): ResolvedCaching {
  const c = (config ?? {}) as {
    caching?: unknown;
    cacheTtlMinutes?: number;
    semanticCache?: { enabled?: boolean; embeddingModel?: string; threshold?: number };
  };

  if (c.caching) {
    const nu = c.caching as {
      exact?: { enabled?: boolean; ttlSeconds?: number };
      semantic?: { enabled?: boolean; ttlSeconds?: number; embeddingModel?: string; threshold?: number };
      overrides?: unknown;
    };
    const embeddingModel = nu.semantic?.embeddingModel ?? '';
    return {
      exact: {
        enabled: nu.exact?.enabled !== false,
        ttlSeconds: clampTtl(nu.exact?.ttlSeconds, DEFAULT_CACHE_TTL_SECONDS),
      },
      semantic: {
        enabled: nu.semantic?.enabled === true,
        ttlSeconds: clampTtl(nu.semantic?.ttlSeconds, DEFAULT_CACHE_TTL_SECONDS),
        embeddingModel,
        threshold: nu.semantic?.threshold ?? getThresholdBand(embeddingModel).default,
      },
      overrides: readOverrides(nu.overrides),
    };
  }

  // Legacy shape. This is the ONLY place minutes are converted to seconds.
  const minutes = typeof c.cacheTtlMinutes === 'number' ? c.cacheTtlMinutes : 1440;
  const ttlSeconds = clampTtl(minutes * 60, DEFAULT_CACHE_TTL_SECONDS);
  const embeddingModel = c.semanticCache?.embeddingModel ?? '';

  return {
    exact: { enabled: ttlSeconds > 0, ttlSeconds },
    semantic: {
      enabled: c.semanticCache?.enabled === true,
      ttlSeconds,
      embeddingModel,
      threshold: c.semanticCache?.threshold ?? getThresholdBand(embeddingModel).default,
    },
    overrides: { ...NO_OVERRIDES },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/caching-config.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Export from both barrels**

In `libs/shared/src/client.ts`, beside the existing `./services/semantic-cache-thresholds` export:

```ts
export { resolveCachingConfig, DEFAULT_CACHE_TTL_SECONDS, MAX_CACHE_TTL_SECONDS } from './services/caching-config';
export type { ResolvedCaching, CacheOverrides } from './services/caching-config';
```

Add the identical two lines to `libs/shared/src/index.ts`.

- [ ] **Step 6: Verify the whole shared project still builds**

Run: `bunx nx test shared --skip-nx-cache && bunx nx run-many -t typecheck -p shared --skip-nx-cache`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/services/caching-config.ts libs/shared/src/services/caching-config.test.ts libs/shared/src/client.ts libs/shared/src/index.ts
git commit -m "feat(cache): resolveCachingConfig normaliser for old and new config shapes"
```

---

### Task 2: Agent config type

**Files:**
- Modify: `libs/agent-studio/src/types/agent.ts` (`SimpleAgentConfig`, currently around lines 40-55)

**Interfaces:**
- Consumes: nothing.
- Produces: `SimpleAgentConfig.caching?: { exact; semantic; overrides }` matching `ResolvedCaching`'s shape with optional members.

- [ ] **Step 1: Replace the caching fields on `SimpleAgentConfig`**

Keep `cacheTtlMinutes` and `semanticCache` declared — old stored configs still contain them and `resolveCachingConfig` reads them — but mark both deprecated so nothing new writes them:

```ts
  /** @deprecated Read via resolveCachingConfig(). Superseded by `caching`. */
  cacheTtlMinutes?: number;
  /** @deprecated Read via resolveCachingConfig(). Superseded by `caching`. */
  semanticCache?: {
    enabled: boolean;
    embeddingModel: string;
    threshold: number;
  };
  caching?: {
    exact?: { enabled: boolean; ttlSeconds: number };
    semantic?: { enabled: boolean; ttlSeconds: number; embeddingModel: string; threshold: number };
    overrides?: {
      withMcpTools?: boolean;
      withBuiltInTools?: boolean;
      inSessions?: boolean;
      withAttachments?: boolean;
      withKnowledgeBase?: boolean;
    };
  };
```

- [ ] **Step 2: Verify**

Run: `bunx nx run-many -t typecheck -p agent-studio,web-ui --skip-nx-cache`
Expected: PASS. Existing readers of `cacheTtlMinutes`/`semanticCache` still compile because the fields remain.

- [ ] **Step 3: Commit**

```bash
git add libs/agent-studio/src/types/agent.ts
git commit -m "feat(cache): caching config shape on SimpleAgentConfig"
```

---

### Task 3: Route — eligibility, per-tier TTLs, latency

The riskiest task. The route serves live traffic and the eligibility chain is where a boolean mistake silently changes behaviour for every agent.

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts` — request schema (~line 73), destructure (~line 180), simpleConfig cast (~line 454), eligibility block (~lines 485-600), the three cache write sites, and both cache-hit response blocks.

**Interfaces:**
- Consumes: `resolveCachingConfig`, `DEFAULT_CACHE_TTL_SECONDS`, `MAX_CACHE_TTL_SECONDS` from `@chatbot/shared`.
- Produces: request fields `exactCacheTtlSeconds`, `semanticCacheTtlSeconds`; response field `cacheType`; `latencyMs` populated on hits.

- [ ] **Step 1: Replace the request schema field**

Delete the `cacheTtlMinutes` line and add:

```ts
  exactCacheTtlSeconds: z.number().int().min(0).max(MAX_CACHE_TTL_SECONDS).optional(),
  semanticCacheTtlSeconds: z.number().int().min(0).max(MAX_CACHE_TTL_SECONDS).optional(),
```

Update the import from `@chatbot/shared` to bring in `resolveCachingConfig` and `MAX_CACHE_TTL_SECONDS`, and remove `DEFAULT_TTL_MINUTES` / `MAX_TTL_MINUTES` if nothing else uses them. Update the destructure to take the two new fields instead of `cacheTtlMinutes`.

- [ ] **Step 2: Replace the eligibility block**

Where `cacheEligible`, `effectiveCacheTtl` and `semanticEnabled` are currently computed, use:

```ts
      const caching = resolveCachingConfig(config);

      const blockers: string[] = [];
      if (hasMcpTools && !caching.overrides.withMcpTools) blockers.push('mcp_tools');
      if (hasBuiltInTools && !caching.overrides.withBuiltInTools) blockers.push('builtin_tools');
      if (sessionId && !caching.overrides.inSessions) blockers.push('session');

      const cacheEligible = !noCache && blockers.length === 0;

      const exactTtl = exactCacheTtlSeconds ?? caching.exact.ttlSeconds;
      const semanticTtl = semanticCacheTtlSeconds ?? caching.semantic.ttlSeconds;

      const exactEnabled = cacheEligible && caching.exact.enabled && exactTtl > 0;

      logger.debug(
        {
          tenantId, agentId, cacheEligible, noCache, blockers,
          exactEnabled, exactTtl, semanticTtl,
          overrides: caching.overrides,
        },
        'Cache eligibility determined',
      );
```

and for the semantic gate, replacing the existing `semanticEnabled` expression:

```ts
      const semanticEnabled =
        cacheEligible &&
        caching.semantic.enabled &&
        semanticTtl > 0 &&
        !!caching.semantic.embeddingModel &&
        env.SEMANTIC_CACHE_ENABLED &&
        (!hasNonTextContent || caching.overrides.withAttachments) &&
        (!hasKbContext || caching.overrides.withKnowledgeBase);
```

Everywhere the old code read `cacheEligible` to decide whether to use the **exact** tier, it must now read `exactEnabled`. That is the exact-tier lookup and all three exact write sites. The semantic sites keep using `semanticEnabled`.

The semantic scope key keeps using `caching.semantic.embeddingModel` and `caching.semantic.threshold`.

- [ ] **Step 3: Use the per-tier TTLs at the write sites**

Exact writes pass `exactTtl`; semantic writes pass `semanticTtl`. Both are seconds, and `ResponseCacheService.set()` / `SemanticCacheService.store()` currently take **minutes** — convert at the call site by dividing is WRONG and lossy. Instead change both service signatures to seconds:

- `ResponseCacheService.set(cacheKey, response, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS)` with `expiresAt = new Date(Date.now() + ttlSeconds * 1000)`.
- `SemanticCacheService.store({ ..., ttlSeconds })` likewise.

Update `libs/shared/src/services/response-cache-service.ts` and `semantic-cache-service.ts` accordingly, and update their existing tests, which assert minute-based expiries.

- [ ] **Step 4: Record latency on cache hits**

In both cache-hit blocks (exact and semantic), add `latencyMs` to the `apiKeyExecution.update` data and pass it to `deliverWebhook` instead of the hard-coded `0`:

```ts
const hitLatencyMs = Date.now() - startedAt.getTime();
```

Use the same `startedAt` the miss paths use.

- [ ] **Step 5: Verify**

Run:
```bash
bunx nx test shared --skip-nx-cache
bunx nx run-many -t typecheck -p shared,agent-studio,web-ui --skip-nx-cache
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3005/api/v1/inference -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'
```
Expected: tests and typecheck pass; curl returns `401` (auth still fails closed). Start a dev server for the curl if none is running, and stop it afterwards.

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts libs/shared/src/services/response-cache-service.ts libs/shared/src/services/semantic-cache-service.ts libs/shared/src/services/response-cache-service.test.ts libs/shared/src/services/semantic-cache-service.test.ts
git commit -m "feat(cache): per-tier eligibility, seconds-based TTLs, latency on hits"
```

---

### Task 4: Eligibility matrix test

Five conditions against override on/off across two tiers is where a hand-written boolean chain goes wrong. It gets its own table-driven test rather than examples scattered through other tasks.

**Files:**
- Create: `libs/shared/src/services/cache-eligibility.ts`
- Create: `libs/shared/src/services/cache-eligibility.test.ts`
- Modify: `apps/web-ui/app/api/v1/inference/route.ts` (use the extracted function)
- Modify: `libs/shared/src/index.ts`, `libs/shared/src/client.ts` (exports)

**Interfaces:**
- Consumes: `ResolvedCaching`, `CacheOverrides` from Task 1.
- Produces:
  - `interface EligibilityInput { noCache: boolean; hasMcpTools: boolean; hasBuiltInTools: boolean; hasSession: boolean; hasAttachments: boolean; hasKbContext: boolean; semanticKillSwitch: boolean }`
  - `interface EligibilityResult { blockers: string[]; exactEnabled: boolean; semanticEnabled: boolean }`
  - `computeCacheEligibility(caching: ResolvedCaching, input: EligibilityInput, exactTtl: number, semanticTtl: number): EligibilityResult`

- [ ] **Step 1: Write the failing test**

```ts
// libs/shared/src/services/cache-eligibility.test.ts
import { describe, it, expect } from 'vitest';
import { computeCacheEligibility, type EligibilityInput } from './cache-eligibility';
import { resolveCachingConfig } from './caching-config';

const bothTiersOn = resolveCachingConfig({
  caching: {
    exact: { enabled: true, ttlSeconds: 60 },
    semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'titan-embed', threshold: 0.5 },
  },
});

const clean: EligibilityInput = {
  noCache: false,
  hasMcpTools: false,
  hasBuiltInTools: false,
  hasSession: false,
  hasAttachments: false,
  hasKbContext: false,
  semanticKillSwitch: true,
};

const run = (caching = bothTiersOn, input: Partial<EligibilityInput> = {}) =>
  computeCacheEligibility(caching, { ...clean, ...input }, 60, 60);

describe('computeCacheEligibility', () => {
  it('enables both tiers when nothing blocks', () => {
    const r = run();
    expect(r.blockers).toEqual([]);
    expect(r.exactEnabled).toBe(true);
    expect(r.semanticEnabled).toBe(true);
  });

  it('noCache beats every override', () => {
    const allOverridden = resolveCachingConfig({
      caching: {
        exact: { enabled: true, ttlSeconds: 60 },
        semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 },
        overrides: {
          withMcpTools: true, withBuiltInTools: true, inSessions: true,
          withAttachments: true, withKnowledgeBase: true,
        },
      },
    });
    const r = computeCacheEligibility(allOverridden, { ...clean, noCache: true }, 60, 60);
    expect(r.exactEnabled).toBe(false);
    expect(r.semanticEnabled).toBe(false);
  });

  describe.each([
    ['hasMcpTools', 'withMcpTools', 'mcp_tools'],
    ['hasBuiltInTools', 'withBuiltInTools', 'builtin_tools'],
    ['hasSession', 'inSessions', 'session'],
  ] as const)('%s blocks BOTH tiers unless overridden', (flag, override, blockerName) => {
    it('blocks both tiers when the override is off', () => {
      const r = run(bothTiersOn, { [flag]: true } as Partial<EligibilityInput>);
      expect(r.blockers).toContain(blockerName);
      expect(r.exactEnabled).toBe(false);
      expect(r.semanticEnabled).toBe(false);
    });

    it('allows both tiers when the override is on', () => {
      const caching = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60 },
          semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 },
          overrides: { [override]: true },
        },
      });
      const r = computeCacheEligibility(caching, { ...clean, [flag]: true }, 60, 60);
      expect(r.blockers).toEqual([]);
      expect(r.exactEnabled).toBe(true);
      expect(r.semanticEnabled).toBe(true);
    });
  });

  describe.each([
    ['hasAttachments', 'withAttachments'],
    ['hasKbContext', 'withKnowledgeBase'],
  ] as const)('%s blocks the SEMANTIC tier only', (flag, override) => {
    it('leaves the exact tier enabled', () => {
      const r = run(bothTiersOn, { [flag]: true } as Partial<EligibilityInput>);
      expect(r.exactEnabled).toBe(true);
      expect(r.semanticEnabled).toBe(false);
      expect(r.blockers).toEqual([]);
    });

    it('enables semantic when the override is on', () => {
      const caching = resolveCachingConfig({
        caching: {
          exact: { enabled: true, ttlSeconds: 60 },
          semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 },
          overrides: { [override]: true },
        },
      });
      const r = computeCacheEligibility(caching, { ...clean, [flag]: true }, 60, 60);
      expect(r.semanticEnabled).toBe(true);
    });
  });

  it('honours each tier toggle independently', () => {
    const exactOnly = resolveCachingConfig({
      caching: { exact: { enabled: true, ttlSeconds: 60 }, semantic: { enabled: false, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 } },
    });
    const semanticOnly = resolveCachingConfig({
      caching: { exact: { enabled: false, ttlSeconds: 60 }, semantic: { enabled: true, ttlSeconds: 60, embeddingModel: 'm', threshold: 0.5 } },
    });
    expect(computeCacheEligibility(exactOnly, clean, 60, 60)).toMatchObject({ exactEnabled: true, semanticEnabled: false });
    expect(computeCacheEligibility(semanticOnly, clean, 60, 60)).toMatchObject({ exactEnabled: false, semanticEnabled: true });
  });

  it('disables a tier whose ttl is zero', () => {
    expect(computeCacheEligibility(bothTiersOn, clean, 0, 60).exactEnabled).toBe(false);
    expect(computeCacheEligibility(bothTiersOn, clean, 60, 0).semanticEnabled).toBe(false);
  });

  it('disables semantic with no embedding model or with the kill switch off', () => {
    const noModel = resolveCachingConfig({
      caching: { exact: { enabled: true, ttlSeconds: 60 }, semantic: { enabled: true, ttlSeconds: 60, embeddingModel: '', threshold: 0.5 } },
    });
    expect(computeCacheEligibility(noModel, clean, 60, 60).semanticEnabled).toBe(false);
    expect(run(bothTiersOn, { semanticKillSwitch: false }).semanticEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/cache-eligibility.test.ts`
Expected: FAIL — `Failed to resolve import "./cache-eligibility"`

- [ ] **Step 3: Write the implementation**

```ts
// libs/shared/src/services/cache-eligibility.ts
import type { ResolvedCaching } from './caching-config';

export interface EligibilityInput {
  noCache: boolean;
  hasMcpTools: boolean;
  hasBuiltInTools: boolean;
  hasSession: boolean;
  hasAttachments: boolean;
  hasKbContext: boolean;
  semanticKillSwitch: boolean;
}

export interface EligibilityResult {
  blockers: string[];
  exactEnabled: boolean;
  semanticEnabled: boolean;
}

export function computeCacheEligibility(
  caching: ResolvedCaching,
  input: EligibilityInput,
  exactTtlSeconds: number,
  semanticTtlSeconds: number,
): EligibilityResult {
  const blockers: string[] = [];
  if (input.hasMcpTools && !caching.overrides.withMcpTools) blockers.push('mcp_tools');
  if (input.hasBuiltInTools && !caching.overrides.withBuiltInTools) blockers.push('builtin_tools');
  if (input.hasSession && !caching.overrides.inSessions) blockers.push('session');

  const eligible = !input.noCache && blockers.length === 0;

  return {
    blockers,
    exactEnabled: eligible && caching.exact.enabled && exactTtlSeconds > 0,
    // Attachments and KB context gate this tier only: the exact key already
    // includes both, so it cannot mismatch on them.
    semanticEnabled:
      eligible &&
      caching.semantic.enabled &&
      semanticTtlSeconds > 0 &&
      !!caching.semantic.embeddingModel &&
      input.semanticKillSwitch &&
      (!input.hasAttachments || caching.overrides.withAttachments) &&
      (!input.hasKbContext || caching.overrides.withKnowledgeBase),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config libs/shared/vitest.config.ts libs/shared/src/services/cache-eligibility.test.ts`
Expected: PASS

- [ ] **Step 5: Use it in the route**

Replace the inline blocker/eligibility code written in Task 3 with a call to `computeCacheEligibility`, and export the function and its types from `libs/shared/src/index.ts` and `libs/shared/src/client.ts`.

- [ ] **Step 6: Verify**

Run: `bunx nx test shared --skip-nx-cache && bunx nx run-many -t typecheck -p shared,web-ui --skip-nx-cache`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/services/cache-eligibility.ts libs/shared/src/services/cache-eligibility.test.ts libs/shared/src/index.ts libs/shared/src/client.ts apps/web-ui/app/api/v1/inference/route.ts
git commit -m "feat(cache): extract and table-test the eligibility matrix"
```

---

### Task 5: The Caching tab

**Files:**
- Create: `apps/web-ui/components/agents/tabs/caching-tab.tsx`
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx` (tab list around line 229, tab content around line 253)
- Modify: `apps/web-ui/components/agents/config/simple-agent-form.tsx` (remove caching controls)

**Interfaces:**
- Consumes: `resolveCachingConfig`, `MAX_CACHE_TTL_SECONDS`, `getThresholdBand`, `getPresetThreshold`, `presetForThreshold` from `@chatbot/shared/client`; `SimpleAgentConfig` from `@chatbot/agent-studio`.
- Produces: `<CachingTab agentId={string} config={SimpleAgentConfig} onSave={(config: SimpleAgentConfig) => void} saving?: boolean />`.

- [ ] **Step 1: Build the tab component**

Structure, using shadcn `Switch`, `Input`, `Slider`, `Alert`, `Label`, `Card`, and the existing `ProviderModelSelect`:

```
Exact cache            [Switch]
  TTL (seconds)        [Input type=number min=0 max=604800]
  "Reuses an answer only when the question is byte-identical."

Semantic cache         [Switch]
  Embedding model      [ProviderModelSelect capability="embedding"]
  Match strictness     [Slider + preset markers]   ← move verbatim from simple-agent-form
  TTL (seconds)        [Input type=number min=0 max=604800]

Advanced
  [Switch] Cache when MCP tools are attached
  [Switch] Cache when built-in tools are attached
  [Switch] Cache inside ongoing conversations
  [Switch] Cache requests with attachments        (semantic only)
  [Switch] Cache when a knowledge base is attached (semantic only)
```

Seed form state with `resolveCachingConfig(config)` so an agent saved under the old shape opens with the right values. On save, always write the new `caching` shape and omit `cacheTtlMinutes` / `semanticCache`.

Each override toggle, when ON, renders a `variant="destructive"` Alert below it with this copy verbatim:

- MCP tools: **"The tool never runs."** "An answer saying a ticket was created will replay with no ticket created."
- Built-in tools: **"Web search and web fetch never run."** "Answers may describe pages as they were when first cached."
- Sessions: **"Turns in a conversation look nearly identical."** "An earlier turn's answer can be replayed for a later, different question."
- Attachments: **"Attachments are not part of the semantic match."** "The same question with a different file can return the earlier file's answer."
- Knowledge base: **"Retrieved context is not part of the semantic match."** "The stored answer was grounded in different context than the current question."

Keep the existing behaviour that the strictness control is hidden until an embedding model is chosen, and keep the `/api/agents/embedding-check` validation on save when the semantic tier is enabled with a TTL above zero.

- [ ] **Step 2: Register the tab**

In the edit page add `<TabsTrigger value="caching">Caching</TabsTrigger>` after `Tools`, and a matching `<TabsContent value="caching">` rendering `<CachingTab ... />` with the same `onSave`/`saving` wiring the Configuration tab uses.

- [ ] **Step 3: Strip caching from the Configuration form**

Remove from `simple-agent-form.tsx`: the `cacheTtlMinutes` field, the whole `semanticCacheEnabled` block, the TTL-zero gate, `semanticError` state, the embedding-check fetch, and the now-unused imports (`Switch`, `Alert*`, `cn`, threshold helpers). Its zod schema keeps only `model`, `systemPrompt`, `temperature`, `maxTokens`. Its `onSave` must pass through `config.caching` unchanged so saving the Configuration tab does not wipe caching settings.

- [ ] **Step 4: Verify**

Run: `bunx nx run-many -t typecheck -p web-ui --skip-nx-cache`
Expected: PASS. Then load `/agents/<id>/edit`, confirm the Caching tab appears and the Configuration tab no longer shows cache fields.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/agents/tabs/caching-tab.tsx "apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx" apps/web-ui/components/agents/config/simple-agent-form.tsx
git commit -m "feat(ui): dedicated Caching tab with per-tier toggles and overrides"
```

---

### Task 6: Read-only caching summary on the agent detail page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx` (config card, currently showing Cache TTL and Semantic cache cells)

**Interfaces:**
- Consumes: `resolveCachingConfig` from `@chatbot/shared/client`.
- Produces: nothing.

- [ ] **Step 1: Replace the two existing cells**

Read `const caching = resolveCachingConfig(agent.config)` and render:

```tsx
<div>
  <span className="text-muted-foreground text-xs block mb-1">Exact cache</span>
  <span>{caching.exact.enabled ? `On · ${caching.exact.ttlSeconds}s` : 'Off'}</span>
</div>
<div>
  <span className="text-muted-foreground text-xs block mb-1">Semantic cache</span>
  <span>
    {caching.semantic.enabled
      ? `On · ${caching.semantic.embeddingModel} · ${caching.semantic.threshold} · ${caching.semantic.ttlSeconds}s`
      : 'Off'}
  </span>
</div>
```

Below the grid, when any override is true, list the enabled ones so an auditor sees the risky settings without opening the editor:

```tsx
{Object.entries(caching.overrides).filter(([, on]) => on).length > 0 && (
  <p className="text-xs text-destructive">
    Cache overrides enabled: {Object.entries(caching.overrides).filter(([, on]) => on).map(([k]) => k).join(', ')}
  </p>
)}
```

- [ ] **Step 2: Verify**

Run: `bunx nx run-many -t typecheck -p web-ui --skip-nx-cache`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/agents/[id]/page.tsx"
git commit -m "feat(ui): caching summary on the agent detail page"
```

---

### Task 7: Cache visibility in the inferences UI

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/inferences/page.tsx` (row type ~line 22, filter state ~line 53, query param ~line 85, table head ~line 274)
- Modify: `apps/web-ui/app/api/inferences/route.ts` — the query schema at line 14 has `cacheHit: z.enum(['true','false']).optional()`, the destructure is at line 33, the where-clause mapping at lines 41-42, and the stats select at line 69
- Modify: `apps/web-ui/components/inferences/inference-metrics.tsx`

**Interfaces:**
- Consumes: `cacheType` on `ApiKeyExecution` (column already exists).
- Produces: nothing.

- [ ] **Step 1: Return and filter `cacheType` in the list API**

In `apps/web-ui/app/api/inferences/route.ts`, replace the `cacheHit` query field (line 14) with:

```ts
  cacheType: z.enum(['exact', 'semantic', 'miss']).optional(),
```

update the destructure (line 33) to take `cacheType`, and replace the where-clause mapping (lines 41-42) with:

```ts
    if (cacheType === 'miss') where.cacheHit = false;
    else if (cacheType) where.cacheType = cacheType;
```

Add `cacheType: true` to the row selection so the list returns it. Leave the stats select at line 69 alone — `cacheHitRate` is unchanged by this work.

- [ ] **Step 2: Add the column and extend the filter**

Add `cacheType: string | null` to the row type. Add a `Cache` column to the table rendering a `Badge`: `Exact` for `'exact'`, `Semantic` for `'semantic'`, and a muted `—` otherwise. Change the existing cache Select from all/hit/miss to `all` / `exact` / `semantic` / `miss` and send it as the `cacheType` param.

- [ ] **Step 3: Show cache type beside latency in the detail metrics**

In `inference-metrics.tsx`, accept `cacheType` on the execution prop and render it next to the latency figure, so a 4 ms request reads as a semantic hit rather than an unexplained outlier.

- [ ] **Step 4: Verify**

Run: `bunx nx run-many -t typecheck -p web-ui --skip-nx-cache`
Expected: PASS. Then open `/inferences`, confirm the Cache column renders and each filter value returns a sensible subset.

- [ ] **Step 5: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/inferences/page.tsx" apps/web-ui/app/api/inferences apps/web-ui/components/inferences/inference-metrics.tsx
git commit -m "feat(ui): show and filter cache type on inference records"
```

---

### Task 8: Live end-to-end verification

Mocked tests prove the units; this proves the feature. Requires AWS SSO (`aws sso login --profile omar-testing-saas-chatbot`) so real Titan embeddings and a real Bedrock chat model are reachable, and a dev server started with `AWS_PROFILE=omar-testing-saas-chatbot`.

**Files:** none modified.

- [ ] **Step 1: Create a throwaway tenant, provider, agent and API key**

Bedrock provider with chat model `apac.amazon.nova-micro-v1:0` and embedding model `amazon.titan-embed-text-v2:0`. Agent config: both tiers on, TTL 3600 seconds each, threshold `0.45`.

- [ ] **Step 2: Exact tier**

Same question twice → first `cacheHit: false`, second `cacheHit: true, cacheType: "exact"`.

- [ ] **Step 3: Semantic tier**

Ask `"how do I reset my password"`, then `"I need to reset my password"` → second is `cacheHit: true, cacheType: "semantic"`. These two measure 0.5288 on Titan, so they clear a 0.45 threshold.

- [ ] **Step 4: Tier independence**

Turn the exact tier off, ask a fresh question twice → the repeat must be `cacheType: "semantic"`, not `"exact"`. Then turn semantic off and exact on and confirm the reverse.

- [ ] **Step 5: Overrides**

Attach a built-in tool. Repeat a question → no caching. Enable `withBuiltInTools`, repeat → caching resumes. **This is the check that proves overrides work in both directions.**

- [ ] **Step 6: `noCache` beats overrides**

With every override enabled, send `noCache: true` twice → both `cacheHit: false`.

- [ ] **Step 7: Latency and cache type**

Open `/inferences`. Cache hits must show a latency of single-digit or low-double-digit milliseconds — not null — and the Cache column must show the right tier. **A null latency here means Task 3 step 4 did not land.**

- [ ] **Step 8: Clean up**

Delete the throwaway tenant, provider, agent, API key, execution rows and every cache row created during the run. Stop the dev server.

- [ ] **Step 9: Record the results**

Write each check and its observed output into the PR description. Do not claim the feature works without this evidence.
