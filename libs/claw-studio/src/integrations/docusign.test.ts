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

import { docusignDescriptor, createDocusignTools } from './docusign';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

const USERINFO = {
  email: 'ada@acme.com',
  accounts: [
    { account_id: 'acc-1', base_uri: 'https://na3.docusign.net', is_default: false },
    { account_id: 'acc-2', base_uri: 'https://eu1.docusign.net', is_default: true },
  ],
};

describe('docusignDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives identity from the userinfo email', async () => {
    fetchMock.mockResolvedValue(jsonResponse(USERINFO));
    const result = await docusignDescriptor.verify({ accessToken: 'tok' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toBe('Connected as ada@acme.com');
      expect(result.meta?.email).toBe('ada@acme.com');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://account.docusign.com/oauth/userinfo',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
  });

  it('fails when no access token is given', async () => {
    const result = await docusignDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when no email comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accounts: [] }));
    const result = await docusignDescriptor.verify({ accessToken: 'tok' });
    expect(result.ok).toBe(false);
  });
});

describe('createDocusignTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('gates the send tool with a name tool-classifier.ts already recognizes', () => {
    const names = createDocusignTools('tenant-1').map((t) => t.name);
    expect(names).toEqual([
      'docusign_list_envelopes',
      'docusign_get_envelope',
      'docusign_list_templates',
      'docusign_send_from_template',
    ]);
  });

  it('reports not-connected when no account exists', async () => {
    const [listEnvelopes] = createDocusignTools('tenant-1');
    const result = await listEnvelopes.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves account context from userinfo (preferring is_default) before calling the real endpoint', async () => {
    store.set('claw-integration-docusign:account:default', { data: { accessToken: 'enc(tok)' } });
    fetchMock.mockResolvedValueOnce(jsonResponse(USERINFO)).mockResolvedValueOnce(jsonResponse({ envelopes: [] }));

    const [listEnvelopes] = createDocusignTools('tenant-1');
    await listEnvelopes.invoke({} as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('https://account.docusign.com/oauth/userinfo');
    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(secondUrl).toContain('https://eu1.docusign.net/restapi/v2.1/accounts/acc-2/envelopes');
    expect(secondInit.headers.Authorization).toBe('Bearer tok');
  });

  it('falls back to the first account when none is marked default', async () => {
    store.set('claw-integration-docusign:account:default', { data: { accessToken: 'enc(tok)' } });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          email: 'a@b.com',
          accounts: [{ account_id: 'acc-1', base_uri: 'https://na3.docusign.net' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ envelopes: [] }));

    const [listEnvelopes] = createDocusignTools('tenant-1');
    await listEnvelopes.invoke({} as never);

    const [secondUrl] = fetchMock.mock.calls[1];
    expect(secondUrl).toContain('https://na3.docusign.net/restapi/v2.1/accounts/acc-1/envelopes');
  });

  it('reports an error string (never throws) when the token has no accounts', async () => {
    store.set('claw-integration-docusign:account:default', { data: { accessToken: 'enc(tok)' } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: 'a@b.com', accounts: [] }));

    const [listEnvelopes] = createDocusignTools('tenant-1');
    const result = await listEnvelopes.invoke({} as never);
    expect(result).toContain('Error listing Docusign envelopes');
  });

  it('gets a single envelope with recipients included', async () => {
    store.set('claw-integration-docusign:account:default', { data: { accessToken: 'enc(tok)' } });
    fetchMock.mockResolvedValueOnce(jsonResponse(USERINFO)).mockResolvedValueOnce(jsonResponse({ status: 'sent' }));

    const tools = createDocusignTools('tenant-1');
    const getEnvelope = tools.find((t) => t.name === 'docusign_get_envelope')!;
    await getEnvelope.invoke({ envelopeId: 'env-1' } as never);

    const [secondUrl] = fetchMock.mock.calls[1];
    const url = new URL(secondUrl as string);
    expect(url.pathname).toBe('/restapi/v2.1/accounts/acc-2/envelopes/env-1');
    expect(url.searchParams.get('include')).toBe('recipients');
  });

  it('sends a template with the default role name and a POST body', async () => {
    store.set('claw-integration-docusign:account:default', { data: { accessToken: 'enc(tok)' } });
    fetchMock.mockResolvedValueOnce(jsonResponse(USERINFO)).mockResolvedValueOnce(jsonResponse({ envelopeId: 'env-1' }));

    const tools = createDocusignTools('tenant-1');
    const sendFromTemplate = tools.find((t) => t.name === 'docusign_send_from_template')!;
    await sendFromTemplate.invoke({
      templateId: 'tpl-1',
      recipientEmail: 'signer@acme.com',
      recipientName: 'Sig Ner',
    } as never);

    const [, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      templateId: 'tpl-1',
      templateRoles: [{ email: 'signer@acme.com', name: 'Sig Ner', roleName: 'Signer' }],
      status: 'sent',
    });
  });
});
