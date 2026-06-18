import pino from 'pino';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

const logger = pino({ name: 'ai:web-search' });

// ---------------------------------------------------------------------------
// Normalized result
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

export interface WebSearchConfig {
  provider: 'tavily' | 'brave' | 'searxng';
  apiKey?: string;
  apiBase?: string;
  maxResults?: number;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface SearchProvider {
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

export class TavilySearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    logger.info({ provider: 'tavily', query, maxResults }, 'Tavily search started');
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_answer: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Tavily API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        results?: Array<{ title: string; url: string; content: string; score?: number }>;
      };

      const results = (data.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.content ?? '',
        score: r.score,
      }));

      logger.info({ provider: 'tavily', resultCount: results.length }, 'Tavily search completed');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ provider: 'tavily', query, errorMessage: error.message }, 'Tavily search failed');
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Brave
// ---------------------------------------------------------------------------

export class BraveSearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    logger.info({ provider: 'brave', query, maxResults }, 'Brave search started');
    try {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(maxResults));

      const res = await fetch(url.toString(), {
        headers: { 'X-Subscription-Token': this.apiKey },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Brave API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        web?: { results?: Array<{ title: string; url: string; description: string }> };
      };

      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.description ?? '',
      }));

      logger.info({ provider: 'brave', resultCount: results.length }, 'Brave search completed');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ provider: 'brave', query, errorMessage: error.message }, 'Brave search failed');
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// SearXNG
// ---------------------------------------------------------------------------

export class SearxngSearchProvider implements SearchProvider {
  constructor(private readonly apiBase: string) {}

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    logger.info({ provider: 'searxng', query, maxResults, apiBase: this.apiBase }, 'SearXNG search started');
    try {
      const url = new URL(`${this.apiBase.replace(/\/$/, '')}/search`);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');

      const res = await fetch(url.toString());

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SearXNG API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        results?: Array<{ title: string; url: string; content: string; score?: number }>;
      };

      const results = (data.results ?? [])
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          content: r.content ?? '',
          score: r.score,
        }));

      logger.info({ provider: 'searxng', resultCount: results.length }, 'SearXNG search completed');
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ provider: 'searxng', query, errorMessage: error.message }, 'SearXNG search failed');
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSearchProvider(config: WebSearchConfig): SearchProvider {
  switch (config.provider) {
    case 'tavily':
      if (!config.apiKey) throw new Error('Tavily provider requires apiKey');
      return new TavilySearchProvider(config.apiKey);
    case 'brave':
      if (!config.apiKey) throw new Error('Brave provider requires apiKey');
      return new BraveSearchProvider(config.apiKey);
    case 'searxng':
      if (!config.apiBase) throw new Error('SearXNG provider requires apiBase');
      return new SearxngSearchProvider(config.apiBase);
    default:
      throw new Error(`Unknown search provider: ${(config as any).provider}`);
  }
}

// ---------------------------------------------------------------------------
// ToolSet entry
// ---------------------------------------------------------------------------

export function buildWebSearchTool(provider: SearchProvider): ToolSet {
  return {
    web_search: tool({
      description:
        'Search the web for current information. Returns a list of results with title, URL, and snippet. Use this when the user asks about recent events, facts you are unsure of, or anything that requires up-to-date information.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (default 5)',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['query'],
      }),
      execute: async (args: unknown) => {
        const { query, maxResults } = args as { query: string; maxResults?: number };
        logger.debug({ query, maxResults }, 'web_search tool invoked by model');
        try {
          const results = await provider.search(query, maxResults);
          if (results.length === 0) {
            logger.debug({ query }, 'web_search returned no results');
            return { results: [], message: 'No results found.' };
          }
          logger.debug(
            { query, resultCount: results.length, firstResultUrl: results[0]?.url },
            'web_search tool completed',
          );
          return {
            results: results.map((r) => ({
              title: r.title,
              url: r.url,
              content: r.content.slice(0, 2000),
            })),
            count: results.length,
          };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error({ query, errorMessage: error.message }, 'web_search tool execution failed');
          return { error: error.message, results: [] };
        }
      },
    }),
  };
}
