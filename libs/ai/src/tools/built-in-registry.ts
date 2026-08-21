import type { ToolSet } from 'ai';
import pino from 'pino';
import {
  type WebSearchConfig,
  createSearchProvider,
  buildWebSearchTool,
} from './web-search';
import { buildWebFetchTool } from './web-fetch';
import { env } from '../env';

const logger = pino({ name: 'ai:built-in-tools' });

// ---------------------------------------------------------------------------
// Env-based fallback config
// ---------------------------------------------------------------------------

function getEnvSearchConfig(): WebSearchConfig | null {
  logger.debug(
    {
      hasTavilyKey: !!env.TAVILY_API_KEY,
      hasBraveKey: !!env.BRAVE_API_KEY,
      hasSearxngBase: !!env.SEARXNG_API_BASE,
    },
    'Checking env vars for web search provider',
  );

  if (env.TAVILY_API_KEY) {
    return { provider: 'tavily', apiKey: env.TAVILY_API_KEY };
  }
  if (env.BRAVE_API_KEY) {
    return { provider: 'brave', apiKey: env.BRAVE_API_KEY };
  }
  if (env.SEARXNG_API_BASE) {
    return { provider: 'searxng', apiBase: env.SEARXNG_API_BASE };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

/** Interface for resolving per-tenant configuration without coupling to @chatbot/shared. */
export interface ConfigResolver {
  get<T = unknown>(key: string): Promise<T | null>;
}

/**
 * Resolve which web search provider a tenant gets: their own configuration
 * first, then environment variables, then none.
 *
 * Exported because Claw needs the same precedence rule but builds LangChain
 * tools rather than an AI SDK ToolSet (see
 * `libs/claw-studio/src/agent/web-tools.ts`) — two copies of this would drift.
 */
export async function resolveSearchConfig(
  tenantId: string,
  options?: { configResolver?: ConfigResolver },
): Promise<WebSearchConfig | null> {
  if (options?.configResolver) {
    try {
      const raw = await options.configResolver.get<WebSearchConfig>('webSearchConfig');
      if (raw && raw.provider) {
        logger.info({ tenantId, provider: raw.provider }, 'Using tenant web search config');
        return raw;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ tenantId, errorMessage: error.message }, 'Failed to read tenant web search config');
    }
  }

  const fromEnv = getEnvSearchConfig();
  if (fromEnv) {
    logger.info({ tenantId, provider: fromEnv.provider }, 'Using env web search config');
    return fromEnv;
  }

  return null;
}

/**
 * Resolve whether the web_fetch tool should be enabled for a tenant: per-tenant
 * config first (key: 'webFetchEnabled'), then the WEB_FETCH_ENABLED env var,
 * defaulting to disabled.
 *
 * Unlike web_search, web_fetch has no provider to configure — it's a pure
 * on/off switch. It must default to off: an always-on built-in tool makes
 * hasBuiltInTools permanently true in the inference route, which permanently
 * disables the LLM response cache for every simple-agent call.
 */
export async function resolveWebFetchEnabled(
  tenantId: string,
  options?: { configResolver?: ConfigResolver },
): Promise<boolean> {
  if (options?.configResolver) {
    try {
      const raw = await options.configResolver.get<boolean>('webFetchEnabled');
      if (raw != null) {
        logger.info({ tenantId, enabled: raw }, 'Using tenant web_fetch config');
        return raw === true;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ tenantId, errorMessage: error.message }, 'Failed to read tenant web_fetch config');
    }
  }

  return env.WEB_FETCH_ENABLED === 'true';
}

/**
 * Build the built-in ToolSet for an agent execution.
 *
 * Reads per-tenant search configuration from the optional configResolver (key: 'webSearchConfig'),
 * then falls back to environment variables. web_fetch is opt-in the same way
 * (key: 'webFetchEnabled') — neither tool is included unless configured.
 */
export async function buildBuiltInTools(
  tenantId: string,
  options?: {
    configResolver?: ConfigResolver;
  },
): Promise<ToolSet> {
  const tools: ToolSet = {};

  // --- Web search (configurable provider) -----------------------------------
  try {
    // Tenant config first, then env — see resolveSearchConfig.
    const searchConfig = await resolveSearchConfig(tenantId, options);

    if (searchConfig) {
      const provider = createSearchProvider(searchConfig);
      const searchTool = buildWebSearchTool(provider);
      Object.assign(tools, searchTool);
    } else {
      logger.info({ tenantId }, 'No web search provider configured — skipping web_search tool');
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ tenantId, errorMessage: error.message }, 'Failed to build web search tool');
  }

  // --- Web fetch (opt-in per tenant — disabled by default) -------------------
  try {
    const fetchEnabled = await resolveWebFetchEnabled(tenantId, options);
    if (fetchEnabled) {
      const fetchTool = buildWebFetchTool();
      Object.assign(tools, fetchTool);
    } else {
      logger.info({ tenantId }, 'web_fetch not enabled for tenant — skipping web_fetch tool');
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ tenantId, errorMessage: error.message }, 'Failed to build web fetch tool');
  }

  logger.debug(
    { tenantId, toolNames: Object.keys(tools), toolCount: Object.keys(tools).length },
    'Built-in tool registry ready',
  );

  return tools;
}
