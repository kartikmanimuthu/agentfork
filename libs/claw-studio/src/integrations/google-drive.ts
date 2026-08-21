/**
 * google-drive.ts — Google Drive tool-only integration: OAuth via the shared
 * Google provider, multi-account, read tools for listing/searching/reading
 * files and an approval-gated write tool for creating a plain-text file.
 *
 * Needs the full `drive` scope, not the narrower `drive.file` — `drive.file`
 * only grants access to files the app itself created, which can't support
 * "search/list a user's existing files." This is a real permission-breadth
 * tradeoff (broad read/write over the user's whole Drive), surfaced plainly
 * in this connector's description, not hidden.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import { verifyViaIdentify } from './oauth-broker';
import { createGoogleOAuthProvider } from './oauth-providers/google';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:google-drive');

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const NOT_CONNECTED = 'Google Drive is not connected. Connect a Google account in Mission Control → Integrations.';
const GOOGLE_NATIVE_MIME_PREFIX = 'application/vnd.google-apps';
/**
 * Google's export endpoint only accepts specific mimeTypes per native type —
 * Sheets does NOT support exporting to text/plain at all (only CSV, PDF, XLSX,
 * ODS, TSV, zip/HTML). Using text/plain unconditionally for every native type,
 * as this used to, made every Google Sheet 400 on export while Docs/Slides
 * happened to work. Note CSV export only covers the FIRST sheet/tab of a
 * multi-sheet spreadsheet — a real Drive API limitation, not fixable here.
 */
const EXPORT_MIME_TYPE_BY_NATIVE_TYPE: Record<string, string> = {
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
};
const DEFAULT_EXPORT_MIME_TYPE = 'text/plain';
/**
 * A real uploaded (non-Google-native) spreadsheet — `alt=media` returns these as raw
 * binary, which is useless to the model. Parsed client-side with `xlsx` instead of
 * exported, since Drive's export endpoint only converts its own native types.
 */
const EXCEL_BINARY_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // legacy .xls
]);
/** Bounds every call — without this, a stalled Drive API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** First sheet/tab only — matches the same, already-documented limitation as native Google Sheets export. */
function excelBufferToCsv(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return '';
  return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
}

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
}

async function driveRequest(accessToken: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

async function driveJson(accessToken: string, url: string, init?: RequestInit): Promise<unknown> {
  const res = await driveRequest(accessToken, url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const googleDriveOAuthProvider = createGoogleOAuthProvider(['https://www.googleapis.com/auth/drive']);

export const googleDriveDescriptor: IntegrationDescriptor = {
  name: 'google_drive',
  displayName: 'Google Drive',
  description: 'List, search, read, and create files in the connected Google account\'s Drive. Grants broad read/write access to the whole Drive, not just files Claw creates.',
  accountMode: 'multi',
  authMode: 'oauth',
  secretFields: ['accessToken', 'refreshToken'],
  verify: verifyViaIdentify(googleDriveOAuthProvider),
  oauth: googleDriveOAuthProvider,
};

export function createGoogleDriveTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, googleDriveDescriptor);

  const google_drive_list_files = tool(
    async ({ account, limit = 20 }: { account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const result = (await driveJson(
          accessToken,
          `${DRIVE_API}/files?pageSize=${limit}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}`,
        )) as { files?: DriveFile[] };
        return truncateOutput(JSON.stringify(result.files ?? [], null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'google_drive_list_files failed');
        return `Error listing Drive files: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_drive_list_files',
      description: 'List recent files in the connected Google Drive.',
      schema: z.object({
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
        limit: z.number().int().optional().describe('Max results, defaults to 20'),
      }),
    },
  );

  const google_drive_search_files = tool(
    async ({ query, account, limit = 20 }: { query: string; account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const q = `name contains '${query.replace(/'/g, "\\'")}'`;
        const result = (await driveJson(
          accessToken,
          `${DRIVE_API}/files?q=${encodeURIComponent(q)}&pageSize=${limit}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}`,
        )) as { files?: DriveFile[] };
        return truncateOutput(JSON.stringify(result.files ?? [], null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'google_drive_search_files failed');
        return `Error searching Drive files: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_drive_search_files',
      description: 'Search files by name in the connected Google Drive.',
      schema: z.object({
        query: z.string().describe('Text to search for in file names'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
        limit: z.number().int().optional().describe('Max results, defaults to 20'),
      }),
    },
  );

  const google_drive_read_file = tool(
    async ({ fileId, account }: { fileId: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const meta = (await driveJson(accessToken, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=name,mimeType`)) as DriveFile;
        const isGoogleNative = meta.mimeType?.startsWith(GOOGLE_NATIVE_MIME_PREFIX);
        const isExcelBinary = !isGoogleNative && !!meta.mimeType && EXCEL_BINARY_MIME_TYPES.has(meta.mimeType);
        const exportMimeType = meta.mimeType ? EXPORT_MIME_TYPE_BY_NATIVE_TYPE[meta.mimeType] ?? DEFAULT_EXPORT_MIME_TYPE : DEFAULT_EXPORT_MIME_TYPE;
        const contentUrl = isGoogleNative
          ? `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`
          : `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
        const res = await driveRequest(accessToken, contentUrl);
        const text = isExcelBinary ? excelBufferToCsv(await res.arrayBuffer()) : await res.text();
        return truncateOutput(JSON.stringify({ name: meta.name, content: text }, null, 2), 3000);
      } catch (error) {
        logger.error({ error, fileId }, 'google_drive_read_file failed');
        return `Error reading Drive file: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_drive_read_file',
      description: 'Read a Drive file\'s text content by its id (from google_drive_list_files/search results). Google Docs/Slides export as plain text; Sheets export as CSV (first sheet/tab only). Uploaded .xlsx/.xls files are parsed and returned as CSV too (first sheet/tab only).',
      schema: z.object({
        fileId: z.string().describe('Drive file id'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
      }),
    },
  );

  const google_drive_create_file = tool(
    async ({ name, content, account }: { name: string; content: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const created = (await driveJson(accessToken, `${DRIVE_API}/files`, {
          method: 'POST',
          body: JSON.stringify({ name, mimeType: 'text/plain' }),
        })) as DriveFile;
        if (!created.id) throw new Error('Drive did not return a file id for the new file');

        await driveRequest(accessToken, `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(created.id)}?uploadType=media`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'text/plain' },
          body: content,
        });
        return truncateOutput(JSON.stringify({ id: created.id, name }, null, 2), 500);
      } catch (error) {
        logger.error({ error, name }, 'google_drive_create_file failed');
        return `Error creating Drive file: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_drive_create_file',
      description: 'Create a new plain-text file in the connected Google Drive. Requires approval.',
      schema: z.object({
        name: z.string().describe('File name'),
        content: z.string().describe('Plain-text file content'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
      }),
    },
  );

  return [google_drive_list_files, google_drive_search_files, google_drive_read_file, google_drive_create_file];
}
