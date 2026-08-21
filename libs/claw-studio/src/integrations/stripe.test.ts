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

import { stripeDescriptor, createStripeTools } from './stripe';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('stripeDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('prefers display_name for the identity label', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'acct_1', display_name: 'Acme Storefront' }));
    const result = await stripeDescriptor.verify({ apiKey: 'rk_live_123' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail).toContain('Acme Storefront');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/account',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer rk_live_123' }) }),
    );
  });

  it('falls back to business_profile.name, then the account id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'acct_1', business_profile: { name: 'Acme LLC' } }));
    const result = await stripeDescriptor.verify({ apiKey: 'rk_live_123' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail).toContain('Acme LLC');

    fetchMock.mockResolvedValue(jsonResponse({ id: 'acct_1' }));
    const result2 = await stripeDescriptor.verify({ apiKey: 'rk_live_123' });
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(result2.detail).toContain('acct_1');
  });

  it('fails when no api key is given', async () => {
    const result = await stripeDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when Stripe rejects the key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Invalid API Key' } }, false, 401));
    const result = await stripeDescriptor.verify({ apiKey: 'bad-key' });
    expect(result.ok).toBe(false);
  });
});

describe('createStripeTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns only the read-only tool set — no write tools for Stripe', () => {
    const names = createStripeTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['stripe_search_customers', 'stripe_list_charges', 'stripe_list_invoices']);
  });

  it('search_customers calls the Stripe API with Bearer auth once connected', async () => {
    store.set('claw-integration-stripe:account:default', { data: { apiKey: 'enc(rk_live_123)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const [searchCustomers] = createStripeTools('tenant-1');
    await searchCustomers.invoke({ query: "email:'jane@example.com'" } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.stripe.com/v1/customers/search?'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer rk_live_123' }) }),
    );
  });

  it('list_charges filters by customer id when given', async () => {
    store.set('claw-integration-stripe:account:default', { data: { apiKey: 'enc(rk_live_123)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const [, listCharges] = createStripeTools('tenant-1');
    await listCharges.invoke({ customerId: 'cus_1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('customer=cus_1'), expect.any(Object));
  });

  it('list_invoices filters by customer id when given', async () => {
    store.set('claw-integration-stripe:account:default', { data: { apiKey: 'enc(rk_live_123)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const [, , listInvoices] = createStripeTools('tenant-1');
    await listInvoices.invoke({ customerId: 'cus_1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('customer=cus_1'), expect.any(Object));
  });

  it('reports not-connected when no account exists', async () => {
    const [searchCustomers] = createStripeTools('tenant-1');
    const result = await searchCustomers.invoke({ query: "email:'jane@example.com'" } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-stripe:account:default', { data: { apiKey: 'enc(rk_live_123)' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Unauthorized' } }, false, 401));

    const [searchCustomers] = createStripeTools('tenant-1');
    const result = await searchCustomers.invoke({ query: "email:'jane@example.com'" } as never);
    expect(result).toContain('Error searching Stripe customers');
    expect(result).toContain('401');
  });
});
