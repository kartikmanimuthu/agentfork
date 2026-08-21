import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  jsonSchema: (schema: unknown) => schema,
  tool: (def: unknown) => def,
}));

const mockPage = {
  goto: vi.fn(),
  title: vi.fn(),
  evaluate: vi.fn(),
  close: vi.fn(),
};
const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn(), route: vi.fn() };
const mockBrowser = { newContext: vi.fn(() => mockContext), close: vi.fn() };
const mockLaunch = vi.fn(() => mockBrowser);

vi.mock('playwright', () => ({
  chromium: { launch: (...args: unknown[]) => mockLaunch(...args) },
}));

const dnsLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => dnsLookup(...args) },
  lookup: (...args: unknown[]) => dnsLookup(...args),
}));

import { fetchWebPage, buildWebFetchTool } from './web-fetch';

/** Shapes a dns.lookup(host, { all: true }) result. */
function resolvesTo(...addresses: string[]) {
  dnsLookup.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
}

function mockResponse(status: number) {
  return { status: () => status };
}

describe('fetchWebPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockReturnValue(mockBrowser);
    mockContext.newPage.mockReturnValue(mockPage);
    mockBrowser.newContext.mockReturnValue(mockContext);
    resolvesTo('93.184.216.34');
  });

  it('returns title/content/contentLength on a 200 response', async () => {
    mockPage.goto.mockResolvedValue(mockResponse(200));
    mockPage.title.mockResolvedValue('Example Title');
    mockPage.evaluate.mockResolvedValue('  some   text  ');

    const result = await fetchWebPage({ url: 'https://example.com' });

    expect(result.title).toBe('Example Title');
    expect(result.content).toBe('some text');
    expect(result.truncated).toBe(false);
    expect(mockBrowser.close).toHaveBeenCalled();
    expect(mockContext.close).toHaveBeenCalled();
    expect(mockPage.close).toHaveBeenCalled();
  });

  it('truncates content longer than maxLength', async () => {
    mockPage.goto.mockResolvedValue(mockResponse(200));
    mockPage.title.mockResolvedValue('T');
    mockPage.evaluate.mockResolvedValue('a'.repeat(200));

    const result = await fetchWebPage({ url: 'https://example.com', maxLength: 50 });

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(50);
  });

  it('normalizes whitespace (CRLF, repeated spaces, 3+ newlines)', async () => {
    mockPage.goto.mockResolvedValue(mockResponse(200));
    mockPage.title.mockResolvedValue('T');
    mockPage.evaluate.mockResolvedValue('line1\r\nline2   spaced\n\n\n\nline3');

    const result = await fetchWebPage({ url: 'https://example.com' });

    expect(result.content).toBe('line1\nline2 spaced\n\nline3');
  });

  it('throws when there is no response', async () => {
    mockPage.goto.mockResolvedValue(null);
    await expect(fetchWebPage({ url: 'https://example.com' })).rejects.toThrow(/no response/i);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('throws on an HTTP error status', async () => {
    mockPage.goto.mockResolvedValue(mockResponse(404));
    await expect(fetchWebPage({ url: 'https://example.com' })).rejects.toThrow(/HTTP 404/);
  });

  it('still closes the browser when goto rejects', async () => {
    mockPage.goto.mockRejectedValue(new Error('network down'));
    await expect(fetchWebPage({ url: 'https://example.com' })).rejects.toThrow('network down');
    expect(mockPage.close).toHaveBeenCalled();
    expect(mockContext.close).toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});

describe('fetchWebPage SSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockReturnValue(mockBrowser);
    mockContext.newPage.mockReturnValue(mockPage);
    mockBrowser.newContext.mockReturnValue(mockContext);
    mockPage.goto.mockResolvedValue(mockResponse(200));
    mockPage.title.mockResolvedValue('T');
    mockPage.evaluate.mockResolvedValue('text');
  });

  it('refuses a blocked destination without launching a browser', async () => {
    resolvesTo('169.254.169.254');

    await expect(fetchWebPage({ url: 'http://metadata.example.com/' })).rejects.toThrow(/blocked/i);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('refuses a non-http scheme without launching a browser', async () => {
    await expect(fetchWebPage({ url: 'file:///etc/passwd' })).rejects.toThrow(/scheme/i);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('installs a request interceptor on the context', async () => {
    resolvesTo('93.184.216.34');

    await fetchWebPage({ url: 'https://example.com' });

    expect(mockContext.route).toHaveBeenCalledWith('**/*', expect.any(Function));
  });

  it('aborts an intercepted request that redirects to a blocked address', async () => {
    resolvesTo('93.184.216.34');
    await fetchWebPage({ url: 'https://example.com' });
    const handler = mockContext.route.mock.calls[0][1] as (route: unknown) => Promise<void>;

    // Chromium resolves redirects internally, so the hop is only visible here.
    resolvesTo('169.254.169.254');
    const route = { abort: vi.fn(), continue: vi.fn(), request: () => ({ url: () => 'http://169.254.169.254/latest/meta-data/' }) };
    await handler(route);

    expect(route.abort).toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it('continues an intercepted request to an allowed address', async () => {
    resolvesTo('93.184.216.34');
    await fetchWebPage({ url: 'https://example.com' });
    const handler = mockContext.route.mock.calls[0][1] as (route: unknown) => Promise<void>;

    const route = { abort: vi.fn(), continue: vi.fn(), request: () => ({ url: () => 'https://example.com/style.css' }) };
    await handler(route);

    expect(route.continue).toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });
});

describe('buildWebFetchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockReturnValue(mockBrowser);
    mockContext.newPage.mockReturnValue(mockPage);
    mockBrowser.newContext.mockReturnValue(mockContext);
    resolvesTo('93.184.216.34');
  });

  it('execute() returns title/url/content/truncated/contentLength on success', async () => {
    mockPage.goto.mockResolvedValue(mockResponse(200));
    mockPage.title.mockResolvedValue('T');
    mockPage.evaluate.mockResolvedValue('content here');

    const toolSet = buildWebFetchTool();
    const result = await (toolSet.web_fetch as any).execute({ url: 'https://example.com' });

    expect(result).toEqual(
      expect.objectContaining({ title: 'T', url: 'https://example.com', content: 'content here', truncated: false }),
    );
  });

  it('execute() returns { error, url } instead of throwing when the fetch fails', async () => {
    mockBrowser.newContext.mockImplementation(() => { throw new Error('launch failed'); });
    const toolSet = buildWebFetchTool();
    const result = await (toolSet.web_fetch as any).execute({ url: 'https://example.com' });
    expect(result).toEqual({ error: 'launch failed', url: 'https://example.com' });
  });
});
