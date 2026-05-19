import { createLogger } from '@chatbot/shared/workers';
import { stripHtml } from '../parsers/index';
import type { PreProcessingConfig } from '../types';

const preprocLogger = createLogger('kb:preprocessing');

// ─── PII patterns ─────────────────────────────────────────────────────────────

const DEFAULT_PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { name: 'phone-us', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE]' },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { name: 'credit-card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CARD]' },
  { name: 'ip-address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
];

// ─── Individual processors ────────────────────────────────────────────────────

export function processHtmlStripping(text: string): string {
  // Only strip if the text looks like HTML
  if (/<[a-z][\s\S]*>/i.test(text)) {
    return stripHtml(text);
  }
  return text;
}

export function processPiiRedaction(text: string, customPatterns?: string[]): string {
  let result = text;

  for (const { pattern, replacement } of DEFAULT_PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  if (customPatterns) {
    for (const raw of customPatterns) {
      try {
        const re = new RegExp(raw, 'g');
        result = result.replace(re, '[REDACTED]');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        preprocLogger.warn({ pattern: raw, errorMessage: error.message }, 'Skipped invalid PII pattern');
      }
    }
  }

  return result;
}

export function processTableExtraction(text: string): string {
  // Convert simple markdown tables to readable text
  const tablePattern = /(\|[^\n]+\|\n)((?:\|[-:]+\|)+\n)((?:\|[^\n]+\|\n)*)/g;
  return text.replace(tablePattern, (_, header, _sep, rows) => {
    const headers = header
      .split('|')
      .map((h: string) => h.trim())
      .filter(Boolean);
    const dataRows = rows
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row: string) =>
        row
          .split('|')
          .map((c: string) => c.trim())
          .filter(Boolean)
      );

    const lines = dataRows.map((cells: string[]) =>
      headers.map((h: string, i: number) => `${h}: ${cells[i] ?? ''}`).join(', ')
    );
    return lines.join('\n') + '\n';
  });
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PreProcessingResult {
  text: string;
  appliedSteps: string[];
}

export function runPreProcessingPipeline(
  rawText: string,
  config: PreProcessingConfig
): PreProcessingResult {
  try {
    let text = rawText;
    const appliedSteps: string[] = [];

    if (config.htmlStripping) {
      text = processHtmlStripping(text);
      appliedSteps.push('html-stripping');
    }

    if (config.tableExtraction) {
      text = processTableExtraction(text);
      appliedSteps.push('table-extraction');
    }

    if (config.piiRedaction) {
      text = processPiiRedaction(text, config.piiPatterns);
      appliedSteps.push('pii-redaction');
    }

    text = normalizeWhitespace(text);
    appliedSteps.push('whitespace-normalization');

    preprocLogger.debug({ appliedSteps, inputLength: rawText.length, outputLength: text.length }, 'Ran preprocessing pipeline');
    return { text, appliedSteps };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    preprocLogger.error({ inputLength: rawText.length, errorMessage: error.message, errorStack: error.stack }, 'Preprocessing pipeline failed');
    throw error;
  }
}
