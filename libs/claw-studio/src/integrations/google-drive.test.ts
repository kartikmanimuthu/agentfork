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
  env: { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' },
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

import * as XLSX from 'xlsx';
import { googleDriveDescriptor, createGoogleDriveTools } from './google-drive';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body };
}

function connect() {
  store.set('claw-integration-google_drive:account:me@gmail.com', {
    data: { accessToken: 'enc(drive-access)', label: 'me@gmail.com' },
  });
}

describe('createGoogleDriveTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set', () => {
    const names = createGoogleDriveTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['google_drive_list_files', 'google_drive_search_files', 'google_drive_read_file', 'google_drive_create_file']);
  });

  it('requests the full drive scope, not drive.file', () => {
    expect(googleDriveDescriptor.oauth!.scopes).toEqual([
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
  });

  it('reports not-connected without calling the API', async () => {
    const [list] = createGoogleDriveTools('tenant-1');
    const result = await list.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('read_file uses the export endpoint for a Google-native doc', async () => {
    connect();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: 'Notes', mimeType: 'application/vnd.google-apps.document' }))
      .mockResolvedValueOnce(textResponse('plain text content'));

    const [, , readFile] = createGoogleDriveTools('tenant-1');
    const result = await readFile.invoke({ fileId: 'f1' } as never);

    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/export?mimeType=text%2Fplain'), expect.anything());
    expect(result).toContain('plain text content');
  });

  it('read_file exports a Google Sheet as CSV, not text/plain (Sheets export rejects text/plain)', async () => {
    connect();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }))
      .mockResolvedValueOnce(textResponse('col1,col2\nval1,val2'));

    const [, , readFile] = createGoogleDriveTools('tenant-1');
    const result = await readFile.invoke({ fileId: 'f3' } as never);

    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/export?mimeType=text%2Fcsv'), expect.anything());
    expect(result).toContain('col1,col2');
  });

  it('read_file parses a real uploaded .xlsx as CSV instead of returning raw binary', async () => {
    connect();
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['name', 'amount'], ['Widget', '42']]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ name: 'report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      )
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => bytes });

    const [, , readFile] = createGoogleDriveTools('tenant-1');
    const result = await readFile.invoke({ fileId: 'f4' } as never);

    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/files/f4?alt=media'), expect.anything());
    expect(result).toContain('name,amount');
    expect(result).toContain('Widget,42');
  });

  it('read_file downloads raw content for a non-native file', async () => {
    connect();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: 'notes.txt', mimeType: 'text/plain' }))
      .mockResolvedValueOnce(textResponse('hello world'));

    const [, , readFile] = createGoogleDriveTools('tenant-1');
    const result = await readFile.invoke({ fileId: 'f2' } as never);

    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/files/f2?alt=media'), expect.anything());
    expect(result).toContain('hello world');
  });

  it('create_file creates metadata then PATCHes content in a second call', async () => {
    connect();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'new-1', name: 'report.txt' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const [, , , createFile] = createGoogleDriveTools('tenant-1');
    const result = await createFile.invoke({ name: 'report.txt', content: 'body text' } as never);

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/files'), expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/upload/drive/v3/files/new-1?uploadType=media'),
      expect.objectContaining({ method: 'PATCH', body: 'body text' }),
    );
    expect(result).toContain('new-1');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'forbidden' }, false, 403));
    const [list] = createGoogleDriveTools('tenant-1');
    const result = await list.invoke({} as never);
    expect(result).toContain('Error listing Drive files');
    expect(result).toContain('403');
  });
});
