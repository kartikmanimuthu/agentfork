import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { data: Record<string, unknown> }>();
const mockGet = vi.fn(async (key: string) => store.get(key)?.data ?? null);
const mockSet = vi.fn(async (key: string, value: Record<string, unknown>) => {
  store.set(key, { data: value });
});
const mockDelete = vi.fn(async (key: string) => store.delete(key));
const mockListByPrefix = vi.fn(async (prefix: string) =>
  Array.from(store.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([configKey, row]) => ({ configKey, data: row.data, updatedAt: new Date(), updatedBy: 'system' })),
);

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  TenantConfigService: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    listByPrefix: mockListByPrefix,
  })),
  EncryptionService: vi.fn().mockImplementation(() => ({
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
  })),
}));

import { figmaDescriptor, createFigmaTools } from './figma';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('figmaDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing access token without calling the API', async () => {
    const result = await figmaDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the email on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'designer@acme.com' }));
    const result = await figmaDescriptor.verify({ accessToken: 'figd-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('designer@acme.com');
      expect(result.meta?.email).toBe('designer@acme.com');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.figma.com/v1/me',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Figma-Token': 'figd-test' }) }),
    );
  });

  it('surfaces the Figma error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Invalid token' }, false, 403));
    const result = await figmaDescriptor.verify({ accessToken: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('403');
  });
});

describe('createFigmaTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const tools = createFigmaTools('tenant-1');
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['figma_get_file', 'figma_get_comments', 'figma_post_comment', 'figma_export_images']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [getFile] = createFigmaTools('tenant-1');
    const result = await getFile.invoke({ fileKey: 'abc123' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('figma_get_file summarizes pages and caps the tree depth', async () => {
    store.set('claw-integration-figma:account:default', { data: { accessToken: 'enc(figd-real)' } });
    fetchMock.mockResolvedValue(
      jsonResponse({
        name: 'My File',
        lastModified: '2026-01-01T00:00:00Z',
        document: {
          id: '0:0',
          name: 'Document',
          type: 'DOCUMENT',
          children: [
            {
              id: '1:1',
              name: 'Page 1',
              type: 'CANVAS',
              children: [
                {
                  id: '1:2',
                  name: 'Frame',
                  type: 'FRAME',
                  children: [{ id: '1:3', name: 'Deeply nested', type: 'RECTANGLE' }],
                },
              ],
            },
          ],
        },
      }),
    );

    const [getFile] = createFigmaTools('tenant-1');
    const result = await getFile.invoke({ fileKey: 'abc123' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.figma.com/v1/files/abc123?depth=2',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Figma-Token': 'figd-real' }) }),
    );
    expect(result).toContain('My File');
    expect(result).toContain('Page 1');
    // Depth is capped: the frame under the page shows a child_count rather
    // than recursing all the way down to "Deeply nested".
    expect(result).not.toContain('Deeply nested');
    expect(result).toContain('child_count');
  });

  it('figma_post_comment is a write tool that posts to the comments endpoint', async () => {
    store.set('claw-integration-figma:account:default', { data: { accessToken: 'enc(figd-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'c1', message: 'hello' }));

    const tools = createFigmaTools('tenant-1');
    const postComment = tools.find((t) => t.name === 'figma_post_comment')!;
    const result = await postComment.invoke({ fileKey: 'abc123', message: 'hello' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.figma.com/v1/files/abc123/comments',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'hello' }) }),
    );
    expect(result).toContain('hello');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-figma:account:default', { data: { accessToken: 'enc(figd-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }, false, 404));

    const [getFile] = createFigmaTools('tenant-1');
    const result = await getFile.invoke({ fileKey: 'missing' } as never);
    expect(result).toContain('Error fetching Figma file');
    expect(result).toContain('404');
  });
});
