import { createLogger } from '../logging/logger';

const logger = createLogger('pii-patterns');

export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export const DEFAULT_PII_PATTERNS: PiiPattern[] = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { name: 'phone-us', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE]' },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { name: 'credit-card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CARD]' },
  { name: 'ip-address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
];

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
        logger.warn({ pattern: raw, errorMessage: error.message }, 'Skipped invalid PII pattern');
      }
    }
  }
  return result;
}