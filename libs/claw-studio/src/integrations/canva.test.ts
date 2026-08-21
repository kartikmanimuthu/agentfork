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

import { canvaDescriptor, createCanvaTools } from './canva';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('canvaDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing access token without calling the API', async () => {
    const result = await canvaDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the display name on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ profile: { display_name: 'Acme Design Team' } }));
    const result = await canvaDescriptor.verify({ accessToken: 'canva-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('Acme Design Team');
      expect(result.meta?.displayName).toBe('Acme Design Team');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/users/me/profile',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer canva-test' }) }),
    );
  });

  it('surfaces the Canva error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_token' }, false, 401));
    const result = await canvaDescriptor.verify({ accessToken: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createCanvaTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set', () => {
    const tools = createCanvaTools('tenant-1');
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['canva_list_designs', 'canva_get_design', 'canva_export_design', 'canva_get_export']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [listDesigns] = createCanvaTools('tenant-1');
    const result = await listDesigns.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('canva_list_designs calls the Canva API once connected', async () => {
    store.set('claw-integration-canva:account:default', { data: { accessToken: 'enc(canva-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ id: 'DAF1', title: 'Poster' }] }));

    const [listDesigns] = createCanvaTools('tenant-1');
    const result = await listDesigns.invoke({ query: 'poster' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/designs?limit=10&query=poster',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer canva-real' }) }),
    );
    expect(result).toContain('Poster');
  });

  it('canva_export_design starts an export job, distinct from canva_get_export polling it', async () => {
    store.set('claw-integration-canva:account:default', { data: { accessToken: 'enc(canva-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ job: { id: 'export-1', status: 'in_progress' } }));

    const tools = createCanvaTools('tenant-1');
    const exportDesign = tools.find((t) => t.name === 'canva_export_design')!;
    const startResult = await exportDesign.invoke({ designId: 'DAF1', format: 'png' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/exports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ design_id: 'DAF1', format: { type: 'png' } }),
      }),
    );
    expect(startResult).toContain('export-1');

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonResponse({ job: { id: 'export-1', status: 'success', urls: ['https://cdn.canva.com/x.png'] } }),
    );
    const getExport = tools.find((t) => t.name === 'canva_get_export')!;
    const pollResult = await getExport.invoke({ exportId: 'export-1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/exports/export-1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer canva-real' }) }),
    );
    expect(pollResult).toContain('success');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-canva:account:default', { data: { accessToken: 'enc(canva-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not_found' }, false, 404));

    const [, getDesign] = createCanvaTools('tenant-1');
    const result = await getDesign.invoke({ designId: 'missing' } as never);
    expect(result).toContain('Error fetching Canva design');
    expect(result).toContain('404');
  });
});
