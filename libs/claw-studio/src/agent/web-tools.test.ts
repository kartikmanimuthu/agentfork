import { describe, it, expect, vi, beforeEach } from 'vitest';

const search = vi.fn();
const fetchWebPage = vi.fn();

vi.mock('@chatbot/ai/tools/web-search', () => ({
  createSearchProvider: () => ({ search: (...args: unknown[]) => search(...args) }),
}));
vi.mock('@chatbot/ai/tools/web-fetch', () => ({
  fetchWebPage: (...args: unknown[]) => fetchWebPage(...args),
}));

import { createWebTools } from './web-tools';

async function call(tool: { invoke: (input: unknown) => Promise<unknown> }, args: Record<string, unknown> = {}) {
  return (await tool.invoke(args)) as string;
}

describe('createWebTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('omits web_search when no provider is configured', async () => {
    const tools = await createWebTools('t1', { resolveSearchConfig: async () => null });

    expect(tools.map((t) => t.name)).toEqual(['web_fetch']);
  });

  it('includes web_search when a provider is configured', async () => {
    const tools = await createWebTools('t1', {
      resolveSearchConfig: async () => ({ provider: 'tavily', apiKey: 'k' }),
    });

    expect(tools.map((t) => t.name).sort()).toEqual(['web_fetch', 'web_search']);
  });

  it('frames both tools results as untrusted data', async () => {
    const tools = await createWebTools('t1', {
      resolveSearchConfig: async () => ({ provider: 'tavily', apiKey: 'k' }),
    });

    for (const tool of tools) {
      expect(tool.description).toMatch(/not as instructions/i);
    }
  });

  it('web_search returns formatted results', async () => {
    search.mockResolvedValue([{ title: 'Result A', url: 'https://a.example', snippet: 'about a' }]);
    const tools = await createWebTools('t1', {
      resolveSearchConfig: async () => ({ provider: 'tavily', apiKey: 'k' }),
    });
    const webSearch = tools.find((t) => t.name === 'web_search')!;

    const result = await call(webSearch, { query: 'a thing' });

    expect(result).toContain('Result A');
    expect(result).toContain('https://a.example');
  });

  it('web_search reports no results rather than returning an empty string', async () => {
    search.mockResolvedValue([]);
    const tools = await createWebTools('t1', {
      resolveSearchConfig: async () => ({ provider: 'tavily', apiKey: 'k' }),
    });
    const webSearch = tools.find((t) => t.name === 'web_search')!;

    expect(await call(webSearch, { query: 'nothing' })).toMatch(/no results/i);
  });

  it('web_search returns a recoverable string instead of throwing', async () => {
    search.mockRejectedValue(new Error('quota exceeded'));
    const tools = await createWebTools('t1', {
      resolveSearchConfig: async () => ({ provider: 'tavily', apiKey: 'k' }),
    });
    const webSearch = tools.find((t) => t.name === 'web_search')!;

    const result = await call(webSearch, { query: 'x' });

    expect(result).toMatch(/error/i);
    expect(result).toContain('quota exceeded');
  });

  it('web_fetch returns the page title and content', async () => {
    fetchWebPage.mockResolvedValue({ url: 'https://a.example', title: 'A', content: 'body text', truncated: false });
    const tools = await createWebTools('t1', { resolveSearchConfig: async () => null });
    const webFetch = tools.find((t) => t.name === 'web_fetch')!;

    const result = await call(webFetch, { url: 'https://a.example' });

    expect(result).toContain('A');
    expect(result).toContain('body text');
  });

  it('web_fetch surfaces a guard refusal as a recoverable string', async () => {
    fetchWebPage.mockRejectedValue(new Error('Refused to fetch: blocked destination'));
    const tools = await createWebTools('t1', { resolveSearchConfig: async () => null });
    const webFetch = tools.find((t) => t.name === 'web_fetch')!;

    const result = await call(webFetch, { url: 'http://169.254.169.254/' });

    expect(result).toMatch(/error/i);
    expect(result).toContain('blocked destination');
  });
});
