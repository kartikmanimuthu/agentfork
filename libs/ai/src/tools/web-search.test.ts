import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep the `ai` helpers lightweight so we test our logic, not the SDK.
vi.mock('ai', () => ({
  jsonSchema: (schema: unknown) => schema,
  tool: (def: unknown) => def,
}));

import {
  TavilySearchProvider,
  BraveSearchProvider,
  SearxngSearchProvider,
  createSearchProvider,
  buildWebSearchTool,
  type SearchProvider,
} from './web-search';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('web-search providers', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  describe('TavilySearchProvider', () => {
    it('normalizes Tavily results and posts the api key + query', async () => {
      const fetchMock = mockFetchOnce({
        results: [
          { title: 'A', url: 'https://a.com', content: 'alpha', score: 0.9 },
          { title: 'B', url: 'https://b.com', content: 'beta' },
        ],
      });

      const provider = new TavilySearchProvider('tvly-key');
      const results = await provider.search('hello', 2);

      expect(results).toEqual([
        { title: 'A', url: 'https://a.com', content: 'alpha', score: 0.9 },
        { title: 'B', url: 'https://b.com', content: 'beta', score: undefined },
      ]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.tavily.com/search');
      const sent = JSON.parse((init as RequestInit).body as string);
      expect(sent).toMatchObject({ api_key: 'tvly-key', query: 'hello', max_results: 2 });
    });

    it('throws on non-ok response', async () => {
      mockFetchOnce({ error: 'bad' }, false, 401);
      const provider = new TavilySearchProvider('tvly-key');
      await expect(provider.search('x')).rejects.toThrow(/Tavily API error 401/);
    });
  });

  describe('BraveSearchProvider', () => {
    it('maps brave web results (description -> content) and sets the token header', async () => {
      const fetchMock = mockFetchOnce({
        web: { results: [{ title: 'A', url: 'https://a.com', description: 'desc' }] },
      });

      const provider = new BraveSearchProvider('brave-key');
      const results = await provider.search('q', 3);

      expect(results).toEqual([{ title: 'A', url: 'https://a.com', content: 'desc' }]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('https://api.search.brave.com/res/v1/web/search');
      expect(String(url)).toContain('q=q');
      expect(String(url)).toContain('count=3');
      expect((init as RequestInit).headers).toMatchObject({ 'X-Subscription-Token': 'brave-key' });
    });
  });

  describe('SearxngSearchProvider', () => {
    it('slices results to maxResults and strips a trailing slash from the base', async () => {
      const fetchMock = mockFetchOnce({
        results: [
          { title: '1', url: 'u1', content: 'c1' },
          { title: '2', url: 'u2', content: 'c2' },
          { title: '3', url: 'u3', content: 'c3' },
        ],
      });

      const provider = new SearxngSearchProvider('http://searx.local/');
      const results = await provider.search('q', 2);

      expect(results).toHaveLength(2);
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('http://searx.local/search');
      expect(String(url)).toContain('format=json');
    });
  });

  describe('createSearchProvider', () => {
    it('builds each provider type', () => {
      expect(createSearchProvider({ provider: 'tavily', apiKey: 'k' })).toBeInstanceOf(TavilySearchProvider);
      expect(createSearchProvider({ provider: 'brave', apiKey: 'k' })).toBeInstanceOf(BraveSearchProvider);
      expect(createSearchProvider({ provider: 'searxng', apiBase: 'http://x' })).toBeInstanceOf(SearxngSearchProvider);
    });

    it('throws when required config is missing', () => {
      expect(() => createSearchProvider({ provider: 'tavily' })).toThrow(/requires apiKey/);
      expect(() => createSearchProvider({ provider: 'brave' })).toThrow(/requires apiKey/);
      expect(() => createSearchProvider({ provider: 'searxng' })).toThrow(/requires apiBase/);
    });
  });

  describe('buildWebSearchTool', () => {
    const provider: SearchProvider = {
      search: vi.fn().mockResolvedValue([
        { title: 'T', url: 'https://t.com', content: 'x'.repeat(5000) },
      ]),
    };

    it('exposes a web_search tool that caps content at 2000 chars', async () => {
      const set = buildWebSearchTool(provider) as Record<string, { execute: (a: unknown) => Promise<any> }>;
      expect(set.web_search).toBeDefined();
      const out = await set.web_search.execute({ query: 'hi' });
      expect(out.count).toBe(1);
      expect(out.results[0].content).toHaveLength(2000);
    });

    it('returns an empty message when there are no results', async () => {
      const empty: SearchProvider = { search: vi.fn().mockResolvedValue([]) };
      const set = buildWebSearchTool(empty) as Record<string, { execute: (a: unknown) => Promise<any> }>;
      const out = await set.web_search.execute({ query: 'hi' });
      expect(out.results).toEqual([]);
      expect(out.message).toMatch(/No results/);
    });

    it('catches provider errors and returns a typed error result', async () => {
      const failing: SearchProvider = { search: vi.fn().mockRejectedValue(new Error('boom')) };
      const set = buildWebSearchTool(failing) as Record<string, { execute: (a: unknown) => Promise<any> }>;
      const out = await set.web_search.execute({ query: 'hi' });
      expect(out.error).toBe('boom');
      expect(out.results).toEqual([]);
    });
  });
});
