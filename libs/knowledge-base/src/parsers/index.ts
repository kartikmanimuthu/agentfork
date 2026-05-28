import { createLogger } from '@chatbot/shared/workers';
import type { DocumentParser } from '../types';

const parserLogger = createLogger('kb:parser');

/**
 * Plain text parser — returns the buffer decoded as UTF-8.
 */
export class TextParser implements DocumentParser {
  async parse(buffer: Buffer, _mimeType: string): Promise<string> {
    try {
      const text = buffer.toString('utf-8');
      parserLogger.debug({ mimeType: _mimeType, length: text.length }, 'Parsed text');
      return text;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      parserLogger.error({ mimeType: _mimeType, errorMessage: error.message, errorStack: error.stack }, 'Failed to parse text');
      throw error;
    }
  }
}

/**
 * HTML parser — strips tags and decodes common HTML entities.
 * No external dependency; suitable for basic HTML documents.
 */
export class HtmlParser implements DocumentParser {
  async parse(buffer: Buffer, _mimeType: string): Promise<string> {
    try {
      const html = buffer.toString('utf-8');
      const text = stripHtml(html);
      parserLogger.debug({ mimeType: _mimeType, length: text.length }, 'Parsed HTML');
      return text;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      parserLogger.error({ mimeType: _mimeType, errorMessage: error.message, errorStack: error.stack }, 'Failed to parse HTML');
      throw error;
    }
  }
}

export function stripHtml(html: string): string {
  return html
    // Remove script and style blocks entirely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    // Replace block-level tags with newlines
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|hr|blockquote|pre)[^>]*>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Markdown parser — returns raw markdown text as-is.
 * Previously stripped markdown syntax; now preserved so MARKDOWN_AWARE
 * chunking can split by headings. Callers that need plain text can apply
 * stripMarkdown() explicitly after parsing.
 */
export class MarkdownParser implements DocumentParser {
  async parse(buffer: Buffer, _mimeType: string): Promise<string> {
    try {
      const text = buffer.toString('utf-8');
      parserLogger.debug({ mimeType: _mimeType, length: text.length }, 'Parsed markdown');
      return text;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      parserLogger.error({ mimeType: _mimeType, errorMessage: error.message, errorStack: error.stack }, 'Failed to parse markdown');
      throw error;
    }
  }
}

export function stripMarkdown(md: string): string {
  return md
    // Remove code fences
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/g, '').trim())
    // Remove inline code
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/(\*{1,3}|_{1,3})([^*_]+)\1/g, '$2')
    // Remove blockquotes
    .replace(/^>\s*/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * PDF parser — requires the `pdf-parse` package at runtime.
 * Falls back gracefully if the package is not installed.
 */
export class PdfParser implements DocumentParser {
  async parse(buffer: Buffer, _mimeType: string): Promise<string> {
    try {
      // @ts-ignore — pdf-parse is an optional peer dependency
      const pdfParse = await import('pdf-parse/lib/pdf-parse.js').then((m) => m.default ?? m);
      const data = await pdfParse(buffer);
      const text = data.text ?? '';
      parserLogger.debug({ mimeType: _mimeType, length: text.length }, 'Parsed PDF');
      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      parserLogger.error({ mimeType: _mimeType, errorMessage: msg }, 'Failed to parse PDF');
      if (msg.includes('Cannot find module')) {
        throw new Error(
          'PDF parsing requires the "pdf-parse" package. Install it with: bun add pdf-parse'
        );
      }
      throw err;
    }
  }
}

/**
 * DOCX parser — requires the `mammoth` package at runtime.
 */
export class DocxParser implements DocumentParser {
  async parse(buffer: Buffer, _mimeType: string): Promise<string> {
    try {
      // @ts-ignore — mammoth is an optional peer dependency
      const mammoth = await import('mammoth').then((m) => m.default ?? m);
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value ?? '';
      parserLogger.debug({ mimeType: _mimeType, length: text.length }, 'Parsed DOCX');
      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      parserLogger.error({ mimeType: _mimeType, errorMessage: msg }, 'Failed to parse DOCX');
      if (msg.includes('Cannot find module')) {
        throw new Error(
          'DOCX parsing requires the "mammoth" package. Install it with: bun add mammoth'
        );
      }
      throw err;
    }
  }
}

/**
 * XLSX parser — requires the `xlsx` package at runtime.
 */
export class XlsxParser implements DocumentParser {
  async parse(buffer: Buffer, _mimeType: string): Promise<string> {
    try {
      // @ts-ignore — xlsx is an optional peer dependency
      const XLSX = await import('xlsx').then((m) => m.default ?? m);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const lines: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        lines.push(`## Sheet: ${sheetName}\n${csv}`);
      }
      const text = lines.join('\n\n');
      parserLogger.debug({ mimeType: _mimeType, length: text.length }, 'Parsed XLSX');
      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      parserLogger.error({ mimeType: _mimeType, errorMessage: msg }, 'Failed to parse XLSX');
      if (msg.includes('Cannot find module')) {
        throw new Error(
          'XLSX parsing requires the "xlsx" package. Install it with: bun add xlsx'
        );
      }
      throw err;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, DocumentParser> = {
  'text/plain': new TextParser(),
  'text/html': new HtmlParser(),
  'text/markdown': new MarkdownParser(),
  'text/x-markdown': new MarkdownParser(),
  'application/pdf': new PdfParser(),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': new DocxParser(),
  'application/msword': new DocxParser(),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': new XlsxParser(),
  'application/vnd.ms-excel': new XlsxParser(),
};

export function getDocumentParser(mimeType: string): DocumentParser {
  const parser = MIME_MAP[mimeType.toLowerCase()];
  if (!parser) {
    // Fall back to plain text for unknown types
    return new TextParser();
  }
  return parser;
}
