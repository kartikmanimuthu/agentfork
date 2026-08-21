// Pure and free of server-only imports so the Caching tab can import it via
// `@chatbot/shared/client`.
import { getThresholdBand } from './semantic-cache-thresholds';

export const DEFAULT_CACHE_TTL_SECONDS = 86400;
export const MAX_CACHE_TTL_SECONDS = 604800;

export interface ExactCacheOverrides {
  withTools: boolean;
  inSessions: boolean;
}

export interface SemanticCacheOverrides extends ExactCacheOverrides {
  withAttachments: boolean;
  withKnowledgeBase: boolean;
}

export interface ResolvedCaching {
  exact: { enabled: boolean; ttlSeconds: number; overrides: ExactCacheOverrides };
  semantic: {
    enabled: boolean;
    ttlSeconds: number;
    embeddingModel: string;
    threshold: number;
    overrides: SemanticCacheOverrides;
  };
}

export const CACHE_OVERRIDE_LABELS: Record<keyof SemanticCacheOverrides, string> = {
  withTools: 'Tools',
  inSessions: 'Conversations',
  withAttachments: 'Attachments',
  withKnowledgeBase: 'Knowledge base (RAG)',
};

const NO_EXACT_OVERRIDES: ExactCacheOverrides = {
  withTools: false,
  inSessions: false,
};

const NO_SEMANTIC_OVERRIDES: SemanticCacheOverrides = {
  ...NO_EXACT_OVERRIDES,
  withAttachments: false,
  withKnowledgeBase: false,
};

interface SharedOverridesShape {
  withMcpTools?: boolean;
  withBuiltInTools?: boolean;
  inSessions?: boolean;
  withAttachments?: boolean;
  withKnowledgeBase?: boolean;
}

function clampTtl(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  return Math.min(Math.round(value), MAX_CACHE_TTL_SECONDS);
}

function readExactOverrides(raw: unknown): ExactCacheOverrides {
  const o = (raw ?? {}) as Partial<ExactCacheOverrides>;
  return {
    withTools: o.withTools === true,
    inSessions: o.inSessions === true,
  };
}

function readSemanticOverrides(raw: unknown): SemanticCacheOverrides {
  const o = (raw ?? {}) as Partial<SemanticCacheOverrides>;
  return {
    ...readExactOverrides(raw),
    withAttachments: o.withAttachments === true,
    withKnowledgeBase: o.withKnowledgeBase === true,
  };
}

// Configs written before the overrides were split per tier carry one shared set with
// separate MCP and built-in tool flags. A cached answer means the tool never runs
// whichever kind it was, so the two collapse into `withTools` with an OR.
function fromSharedOverrides(raw: unknown): { exact: ExactCacheOverrides; semantic: SemanticCacheOverrides } {
  const o = (raw ?? {}) as SharedOverridesShape;
  const exact: ExactCacheOverrides = {
    withTools: o.withMcpTools === true || o.withBuiltInTools === true,
    inSessions: o.inSessions === true,
  };
  return {
    exact,
    semantic: {
      ...exact,
      withAttachments: o.withAttachments === true,
      withKnowledgeBase: o.withKnowledgeBase === true,
    },
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
      exact?: { enabled?: boolean; ttlSeconds?: number; overrides?: unknown };
      semantic?: {
        enabled?: boolean;
        ttlSeconds?: number;
        embeddingModel?: string;
        threshold?: number;
        overrides?: unknown;
      };
      overrides?: unknown;
    };
    const perTier = nu.exact?.overrides != null || nu.semantic?.overrides != null;
    const shared = perTier ? null : fromSharedOverrides(nu.overrides);
    const embeddingModel = nu.semantic?.embeddingModel ?? '';
    return {
      exact: {
        enabled: nu.exact?.enabled !== false,
        ttlSeconds: clampTtl(nu.exact?.ttlSeconds, DEFAULT_CACHE_TTL_SECONDS),
        overrides: shared ? shared.exact : readExactOverrides(nu.exact?.overrides),
      },
      semantic: {
        enabled: nu.semantic?.enabled === true,
        ttlSeconds: clampTtl(nu.semantic?.ttlSeconds, DEFAULT_CACHE_TTL_SECONDS),
        embeddingModel,
        threshold: nu.semantic?.threshold ?? getThresholdBand(embeddingModel).default,
        overrides: shared ? shared.semantic : readSemanticOverrides(nu.semantic?.overrides),
      },
    };
  }

  // Legacy shape. This is the ONLY place minutes are converted to seconds.
  // A config carrying no caching keys at all is not legacy configuration — it is an
  // agent nobody configured, so both tiers stay off. The TTL still carries the default
  // so the UI has a sensible number to show the moment a tier is switched on.
  const legacyMinutes = typeof c.cacheTtlMinutes === 'number' ? c.cacheTtlMinutes : null;
  const ttlSeconds =
    legacyMinutes === null
      ? DEFAULT_CACHE_TTL_SECONDS
      : clampTtl(legacyMinutes * 60, DEFAULT_CACHE_TTL_SECONDS);
  const embeddingModel = c.semanticCache?.embeddingModel ?? '';

  return {
    exact: {
      enabled: legacyMinutes !== null && ttlSeconds > 0,
      ttlSeconds,
      overrides: { ...NO_EXACT_OVERRIDES },
    },
    semantic: {
      enabled: legacyMinutes !== null && c.semanticCache?.enabled === true,
      ttlSeconds,
      embeddingModel,
      threshold: c.semanticCache?.threshold ?? getThresholdBand(embeddingModel).default,
      overrides: { ...NO_SEMANTIC_OVERRIDES },
    },
  };
}
