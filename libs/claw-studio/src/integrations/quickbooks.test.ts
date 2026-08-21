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

import { quickbooksDescriptor, createQuickbooksTools } from './quickbooks';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('quickbooksDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives identity from CompanyInfo.CompanyName', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ CompanyInfo: { CompanyName: 'Acme Corp' } }));
    const result = await quickbooksDescriptor.verify({ accessToken: 'tok', realmId: '123' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toBe('Connected to Acme Corp');
      expect(result.meta?.companyName).toBe('Acme Corp');
    }
  });

  it('hits production host by default', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ CompanyInfo: { CompanyName: 'Acme Corp' } }));
    await quickbooksDescriptor.verify({ accessToken: 'tok', realmId: '123' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://quickbooks.api.intuit.com/v3/company/123/companyinfo/123',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
  });

  it('hits the sandbox host when environment starts with "sand"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ CompanyInfo: { CompanyName: 'Acme Corp' } }));
    await quickbooksDescriptor.verify({ accessToken: 'tok', realmId: '123', environment: 'sandbox' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123',
      expect.any(Object),
    );
  });

  it('fails when a required field is missing', async () => {
    const result = await quickbooksDescriptor.verify({ accessToken: 'tok' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when no company name comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ CompanyInfo: {} }));
    const result = await quickbooksDescriptor.verify({ accessToken: 'tok', realmId: '123' });
    expect(result.ok).toBe(false);
  });
});

describe('createQuickbooksTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('exposes only read tools (no writes on this read-only connector)', () => {
    const names = createQuickbooksTools('tenant-1').map((t) => t.name);
    expect(names).toEqual([
      'quickbooks_query',
      'quickbooks_list_customers',
      'quickbooks_list_invoices',
      'quickbooks_get_report',
    ]);
  });

  it('reports not-connected when no account exists', async () => {
    const [query] = createQuickbooksTools('tenant-1');
    const result = await query.invoke({ query: 'SELECT * FROM Customer' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the single default account and calls the production host', async () => {
    store.set('claw-integration-quickbooks:account:default', {
      data: { accessToken: 'enc(tok)', realmId: '123' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ QueryResponse: {} }));

    const [query] = createQuickbooksTools('tenant-1');
    await query.invoke({ query: 'SELECT * FROM Customer' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://quickbooks.api.intuit.com/v3/company/123/query?query='),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
  });

  it('appends MAXRESULTS to a query that does not already specify it', async () => {
    store.set('claw-integration-quickbooks:account:default', {
      data: { accessToken: 'enc(tok)', realmId: '123' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ QueryResponse: {} }));

    const [query] = createQuickbooksTools('tenant-1');
    await query.invoke({ query: 'SELECT * FROM Invoice' } as never);

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(calledUrl as string);
    expect(url.searchParams.get('query')).toBe('SELECT * FROM Invoice MAXRESULTS 10');
  });

  it('does not double-append MAXRESULTS when the query already has one', async () => {
    store.set('claw-integration-quickbooks:account:default', {
      data: { accessToken: 'enc(tok)', realmId: '123' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ QueryResponse: {} }));

    const [query] = createQuickbooksTools('tenant-1');
    await query.invoke({ query: 'SELECT * FROM Invoice MAXRESULTS 5' } as never);

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(calledUrl as string);
    expect(url.searchParams.get('query')).toBe('SELECT * FROM Invoice MAXRESULTS 5');
  });

  it('uses the sandbox host for tools when the stored account has a sandbox environment', async () => {
    store.set('claw-integration-quickbooks:account:default', {
      data: { accessToken: 'enc(tok)', realmId: '123', environment: 'sandbox' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ QueryResponse: {} }));

    const tools = createQuickbooksTools('tenant-1');
    const listCustomers = tools.find((t) => t.name === 'quickbooks_list_customers')!;
    await listCustomers.invoke({} as never);

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain('sandbox-quickbooks.api.intuit.com');
  });

  it('builds a report request with optional date params', async () => {
    store.set('claw-integration-quickbooks:account:default', {
      data: { accessToken: 'enc(tok)', realmId: '123' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ Header: {} }));

    const tools = createQuickbooksTools('tenant-1');
    const getReport = tools.find((t) => t.name === 'quickbooks_get_report')!;
    await getReport.invoke({ report: 'ProfitAndLoss', startDate: '2026-01-01', endDate: '2026-01-31' } as never);

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(calledUrl as string);
    expect(url.pathname).toBe('/v3/company/123/reports/ProfitAndLoss');
    expect(url.searchParams.get('start_date')).toBe('2026-01-01');
    expect(url.searchParams.get('end_date')).toBe('2026-01-31');
  });

  it('surfaces API errors as a descriptive string rather than throwing', async () => {
    store.set('claw-integration-quickbooks:account:default', {
      data: { accessToken: 'enc(tok)', realmId: '123' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ Fault: 'boom' }, false, 401));

    const [query] = createQuickbooksTools('tenant-1');
    const result = await query.invoke({ query: 'SELECT * FROM Customer' } as never);
    expect(result).toContain('Error running QuickBooks query');
  });
});
