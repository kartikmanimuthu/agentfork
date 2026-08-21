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

const imapConnect = vi.fn().mockResolvedValue(undefined);
const imapLogout = vi.fn().mockResolvedValue(undefined);
const imapClose = vi.fn();
const imapMailboxOpen = vi.fn().mockResolvedValue(undefined);
const imapSearch = vi.fn().mockResolvedValue([1, 2, 3]);
const imapFetchAll = vi.fn().mockResolvedValue([
  { uid: 3, envelope: { subject: 'Hello', from: [{ address: 'a@x.com' }], date: new Date('2026-01-01') } },
]);
const imapFetchOne = vi.fn().mockResolvedValue({ uid: 3, source: Buffer.from('raw') });
const imapOn = vi.fn();

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: imapConnect,
    logout: imapLogout,
    close: imapClose,
    mailboxOpen: imapMailboxOpen,
    search: imapSearch,
    fetchAll: imapFetchAll,
    fetchOne: imapFetchOne,
    on: imapOn,
  })),
}));

const sendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

vi.mock('mailparser', () => ({
  simpleParser: vi.fn().mockResolvedValue({ subject: 'Hello', from: { text: 'a@x.com' }, date: new Date('2026-01-01'), text: 'body text' }),
}));

import { emailDescriptor, createEmailTools } from './email';

const account = { address: 'me@gmail.com', appPassword: 'app-pass-1234' };

describe('emailDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    imapConnect.mockResolvedValue(undefined);
  });

  it('rejects missing credentials without connecting', async () => {
    const result = await emailDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(imapConnect).not.toHaveBeenCalled();
  });

  it('infers gmail.com IMAP host and succeeds on a working login', async () => {
    const result = await emailDescriptor.verify(account);
    expect(result.ok).toBe(true);
    expect(imapConnect).toHaveBeenCalled();
  });

  it('surfaces the IMAP error on a failed login', async () => {
    imapConnect.mockRejectedValueOnce(new Error('Invalid credentials'));
    const result = await emailDescriptor.verify(account);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Invalid credentials');
  });

  it('fails with a clear error for a domain with no known IMAP host and none provided', async () => {
    const result = await emailDescriptor.verify({ address: 'me@unknown-domain.test', appPassword: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('IMAP host');
    expect(imapConnect).not.toHaveBeenCalled();
  });
});

describe('createEmailTools', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('gates the send tool and leaves reads ungated', () => {
    const names = createEmailTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['email_search_messages', 'email_read_message', 'email_send_message']);
  });

  it('reports not-connected without opening a connection when no account exists', async () => {
    const [search] = createEmailTools('tenant-1');
    const result = await search.invoke({} as never);
    expect(result).toContain('No email account is connected');
    expect(imapConnect).not.toHaveBeenCalled();
  });

  it('search_messages opens INBOX read-only and returns parsed results', async () => {
    store.set('claw-integration-email:account:default', { data: { address: account.address, appPassword: `enc(${account.appPassword})` } });
    const [search] = createEmailTools('tenant-1');
    const result = await search.invoke({ from: 'someone@x.com' } as never);

    expect(imapMailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(imapSearch).toHaveBeenCalledWith({ from: 'someone@x.com' }, { uid: true });
    expect(result).toContain('Hello');
    expect(imapLogout).toHaveBeenCalled();
  });

  it('read_message parses the raw source via mailparser', async () => {
    store.set('claw-integration-email:account:default', { data: { address: account.address, appPassword: `enc(${account.appPassword})` } });
    const [, read] = createEmailTools('tenant-1');
    const result = await read.invoke({ uid: 3 } as never);
    expect(result).toContain('body text');
  });

  it('send_message sends via SMTP and reports the message id', async () => {
    store.set('claw-integration-email:account:default', { data: { address: account.address, appPassword: `enc(${account.appPassword})` } });
    const [, , send] = createEmailTools('tenant-1');
    const result = await send.invoke({ to: 'x@y.com', subject: 'Hi', body: 'test' } as never);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: account.address, to: 'x@y.com', subject: 'Hi', text: 'test' }),
    );
    expect(result).toContain('msg-1');
  });

  it('a failed IMAP call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-email:account:default', { data: { address: account.address, appPassword: `enc(${account.appPassword})` } });
    imapConnect.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const [search] = createEmailTools('tenant-1');
    const result = await search.invoke({} as never);
    expect(result).toContain('Error searching mailbox');
    expect(result).toContain('ETIMEDOUT');
  });
});
