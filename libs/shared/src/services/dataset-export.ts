/**
 * Pure transforms that serialize curated dataset items into common
 * data-science / model-training file formats. No I/O — callers (an API route
 * or a worker) own fetching items and streaming the result.
 */

export type DatasetExportFormat = 'jsonl' | 'json' | 'openai' | 'prompt-completion' | 'anthropic' | 'csv';

export interface ExportableItem {
  input: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ExportResult {
  content: string;
  contentType: string;
  extension: string;
}

/** Coerce an arbitrary value into a plain text string. */
function extractText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
  }
  return JSON.stringify(value);
}

/** Pull a system prompt out of an item's input, if one is present. */
function extractSystem(input: unknown): string | undefined {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.systemPrompt === 'string' && obj.systemPrompt.length > 0) return obj.systemPrompt;
    if (typeof obj.system === 'string' && obj.system.length > 0) return obj.system;
  }
  return undefined;
}

/** Derive the conversation turns (excluding any assistant target) from an item's input. */
function extractMessages(input: unknown): ChatMessage[] {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.messages)) {
      return obj.messages.map((m) => {
        const msg = (m ?? {}) as Record<string, unknown>;
        return {
          role: typeof msg.role === 'string' ? msg.role : 'user',
          content: extractText(msg.content ?? msg),
        };
      });
    }
    if (typeof obj.role === 'string' && 'content' in obj) {
      return [{ role: obj.role, content: extractText(obj.content) }];
    }
  }
  return [{ role: 'user', content: extractText(input) }];
}

function hasExpectedOutput(item: ExportableItem): boolean {
  return item.expectedOutput !== undefined && item.expectedOutput !== null;
}

function toOpenAiRow(item: ExportableItem): string {
  const messages: ChatMessage[] = [];
  const system = extractSystem(item.input);
  if (system) messages.push({ role: 'system', content: system });
  messages.push(...extractMessages(item.input));
  if (hasExpectedOutput(item)) messages.push({ role: 'assistant', content: extractText(item.expectedOutput) });
  return JSON.stringify({ messages });
}

function toAnthropicRow(item: ExportableItem): string {
  const system = extractSystem(item.input);
  const messages: ChatMessage[] = [...extractMessages(item.input)];
  if (hasExpectedOutput(item)) messages.push({ role: 'assistant', content: extractText(item.expectedOutput) });
  const row: { system?: string; messages: ChatMessage[] } = { messages };
  if (system) row.system = system;
  return JSON.stringify(row);
}

function toPromptCompletionRow(item: ExportableItem): string {
  const parts: string[] = [];
  const system = extractSystem(item.input);
  if (system) parts.push(system);
  for (const m of extractMessages(item.input)) parts.push(m.content);
  return JSON.stringify({ prompt: parts.join('\n'), completion: extractText(item.expectedOutput) });
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function toCsv(items: ExportableItem[]): string {
  const header = 'input,expected_output,metadata';
  const rows = items.map((it) =>
    [csvCell(it.input), csvCell(it.expectedOutput), csvCell(it.metadata)].map(csvEscape).join(','),
  );
  return [header, ...rows].join('\n');
}

const NDJSON = 'application/x-ndjson';

export function exportDatasetItems(items: ExportableItem[], format: DatasetExportFormat): ExportResult {
  switch (format) {
    case 'jsonl':
      return {
        content: items
          .map((it) => JSON.stringify({ input: it.input, expectedOutput: it.expectedOutput ?? null, metadata: it.metadata ?? null }))
          .join('\n'),
        contentType: NDJSON,
        extension: 'jsonl',
      };
    case 'json':
      return {
        content: JSON.stringify(
          items.map((it) => ({ input: it.input, expectedOutput: it.expectedOutput ?? null, metadata: it.metadata ?? null })),
          null,
          2,
        ),
        contentType: 'application/json',
        extension: 'json',
      };
    case 'openai':
      return { content: items.map(toOpenAiRow).join('\n'), contentType: NDJSON, extension: 'jsonl' };
    case 'anthropic':
      return { content: items.map(toAnthropicRow).join('\n'), contentType: NDJSON, extension: 'jsonl' };
    case 'prompt-completion':
      return { content: items.map(toPromptCompletionRow).join('\n'), contentType: NDJSON, extension: 'jsonl' };
    case 'csv':
      return { content: toCsv(items), contentType: 'text/csv', extension: 'csv' };
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${String(exhaustive)}`);
    }
  }
}
