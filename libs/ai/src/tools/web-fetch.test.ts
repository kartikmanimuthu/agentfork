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
const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
const mockBrowser = { newContext: vi.fn(() => mockContext), close: vi.fn() };

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(() => mockBrowser) },
}));

import { fetchWebPage, buildWebFetchTool } from './web-fetch';

function mockResponse(status: number) {
  return { status: () => status };
}

describe('fetchWebPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.newPage.mockReturnValue(mockPage);
    mockBrowser.newContext.mockReturnValue(mockContext);
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

describe('buildWebFetchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.newPage.mockReturnValue(mockPage);
    mockBrowser.newContext.mockReturnValue(mockContext);
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
