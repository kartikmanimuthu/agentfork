import * as XLSX from 'xlsx';
import pino from 'pino';
import type { MessagePart } from './stream-events';

const logger = pino({ name: 'ai:file-generation' });

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface FileUploader {
  /** Upload a buffer and return a public URL and the storage key. */
  upload(buffer: Buffer, filename: string, mimeType: string): Promise<{ url: string; key: string }>;
}

export interface FilePart extends Extract<MessagePart, { type: 'file' }> {}

export interface FileGenResult {
  __filePart: FilePart;
}

// ---------------------------------------------------------------------------
// Spreadsheet
// ---------------------------------------------------------------------------

export interface SheetDef {
  name: string;
  /** Each element is a row: an object whose keys become column headers. */
  rows: Record<string, unknown>[];
}

export interface SpreadsheetInput {
  filename?: string;
  sheets: SheetDef[];
}

export async function generateSpreadsheet(
  input: SpreadsheetInput,
  uploader: FileUploader,
): Promise<FileGenResult> {
  const filename = input.filename ?? 'report.xlsx';
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  logger.info({ filename, sheetCount: input.sheets.length }, 'Generating spreadsheet');

  try {
    const wb = XLSX.utils.book_new();
    for (const sheet of input.sheets) {
      const ws = XLSX.utils.json_to_sheet(sheet.rows);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }

    const arrayBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const buffer = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer);

    logger.info({ filename, sizeBytes: buffer.length }, 'Spreadsheet buffer generated, uploading');

    const { url } = await uploader.upload(buffer, filename, mimeType);

    logger.info({ filename, url }, 'Spreadsheet uploaded');

    return {
      __filePart: {
        type: 'file',
        name: filename,
        mimeType,
        url,
        sizeBytes: buffer.length,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ filename, errorMessage: error.message, errorStack: error.stack }, 'Spreadsheet generation failed');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PDF (minimal pure-JS builder — no external PDF library required)
// ---------------------------------------------------------------------------

export interface PdfInput {
  filename?: string;
  title?: string;
  content: string;
}

/**
 * Build a minimal but spec-compliant PDF 1.4 document containing the given
 * text content. Uses only ASCII/Latin-1 so no font embedding is needed.
 * The output starts with `%PDF` as required by the PDF spec.
 */
function buildMinimalPdf(title: string, content: string): Buffer {
  // Sanitize: replace non-Latin-1 chars and PDF special chars
  const sanitize = (s: string) =>
    s
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  const safeTitle = sanitize(title);
  const lines = content.split('\n').map(sanitize);

  // Build page content stream: title + body lines
  const fontSize = 12;
  const lineHeight = fontSize * 1.4;
  const marginX = 50;
  const pageHeight = 792; // US Letter
  const startY = pageHeight - 72;

  const textOps: string[] = [
    'BT',
    `/F1 14 Tf`,
    `${marginX} ${startY} Td`,
    `(${safeTitle}) Tj`,
    `/F1 ${fontSize} Tf`,
    `0 -${Math.round(lineHeight * 1.5)} Td`,
  ];
  for (const line of lines) {
    textOps.push(`(${line || ' '}) Tj`);
    textOps.push(`0 -${Math.round(lineHeight)} Td`);
  }
  textOps.push('ET');

  const contentStream = textOps.join('\n');
  const streamBytes = Buffer.from(contentStream, 'latin1');

  // PDF object assembly
  const objects: string[] = [];
  const offsets: number[] = [];

  // We'll collect the full PDF in parts
  const parts: Buffer[] = [];
  let offset = 0;

  const push = (s: string) => {
    const buf = Buffer.from(s, 'latin1');
    parts.push(buf);
    offset += buf.length;
  };

  // Header
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // Object 1: Catalog
  offsets[1] = offset;
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages
  offsets[2] = offset;
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Object 3: Page
  offsets[3] = offset;
  push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );

  // Object 4: Content stream
  offsets[4] = offset;
  push(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  parts.push(streamBytes);
  offset += streamBytes.length;
  push('\nendstream\nendobj\n');

  // Object 5: Font
  offsets[5] = offset;
  push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica\n' +
    '   /Encoding /WinAnsiEncoding >>\nendobj\n',
  );

  // Cross-reference table
  const xrefOffset = offset;
  const objCount = 6; // objects 0–5
  let xref = `xref\n0 ${objCount}\n`;
  xref += '0000000000 65535 f \n'; // object 0 (free)
  for (let i = 1; i < objCount; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);

  // Trailer
  push(
    `trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Buffer.concat(parts);
}

export async function generatePdf(
  input: PdfInput,
  uploader: FileUploader,
): Promise<FileGenResult> {
  const filename = input.filename ?? 'document.pdf';
  const title = input.title ?? filename;
  const mimeType = 'application/pdf';

  logger.info({ filename, title }, 'Generating PDF');

  try {
    const buffer = buildMinimalPdf(title, input.content);

    logger.info({ filename, sizeBytes: buffer.length }, 'PDF buffer generated, uploading');

    const { url } = await uploader.upload(buffer, filename, mimeType);

    logger.info({ filename, url }, 'PDF uploaded');

    return {
      __filePart: {
        type: 'file',
        name: filename,
        mimeType,
        url,
        sizeBytes: buffer.length,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ filename, errorMessage: error.message, errorStack: error.stack }, 'PDF generation failed');
    throw error;
  }
}
