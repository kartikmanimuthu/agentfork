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
 * Build the built-in ToolSet for an agent execution.
 *
 * Reads per-tenant search configuration from the optional configResolver (key: 'webSearchConfig'),
 * then falls back to environment variables. If no search provider is configured,
 * the registry still includes `web_fetch`.
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
    let searchConfig: WebSearchConfig | null = null;

    // 1. Try tenant config via the provided resolver
    if (options?.configResolver) {
      try {
        const raw = await options.configResolver.get<WebSearchConfig>('webSearchConfig');
        if (raw && raw.provider) {
          searchConfig = raw;
          logger.info({ tenantId, provider: raw.provider }, 'Using tenant web search config');
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn({ tenantId, errorMessage: error.message }, 'Failed to read tenant web search config');
      }
    }

    // 2. Fall back to env vars
    if (!searchConfig) {
      searchConfig = getEnvSearchConfig();
      if (searchConfig) {
        logger.info({ tenantId, provider: searchConfig.provider }, 'Using env web search config');
      }
    }

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

  // --- Web fetch (always available if Playwright is present) ----------------
  try {
    const fetchTool = buildWebFetchTool();
    Object.assign(tools, fetchTool);
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
