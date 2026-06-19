import { describe, it, expect } from 'vitest';
import { exportDatasetItems, type ExportableItem } from './dataset-export';

const withMessages: ExportableItem = {
  input: { messages: [{ role: 'user', content: 'hi' }], systemPrompt: 'be nice' },
  expectedOutput: { content: 'hello there' },
  metadata: { sourceType: 'EXECUTION' },
};

const simplePair: ExportableItem = {
  input: { content: 'what is 2+2?' },
  expectedOutput: { content: '4' },
};

const noExpected: ExportableItem = {
  input: 'just an input',
};

describe('exportDatasetItems — jsonl (native)', () => {
  it('emits one JSON object per line preserving input/expectedOutput/metadata', () => {
    const { content, contentType, extension } = exportDatasetItems([withMessages, simplePair], 'jsonl');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      input: withMessages.input,
      expectedOutput: withMessages.expectedOutput,
      metadata: withMessages.metadata,
    });
    expect(JSON.parse(lines[1]).metadata).toBeNull();
    expect(contentType).toBe('application/x-ndjson');
    expect(extension).toBe('jsonl');
  });
});

describe('exportDatasetItems — json', () => {
  it('emits a pretty-printed array', () => {
    const { content, extension } = exportDatasetItems([simplePair], 'json');
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].input).toEqual(simplePair.input);
    expect(extension).toBe('json');
  });
});

describe('exportDatasetItems — openai chat fine-tuning', () => {
  it('builds messages with system, user, and assistant turns', () => {
    const { content } = exportDatasetItems([withMessages], 'openai');
    const row = JSON.parse(content.trim());
    expect(row.messages).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ]);
  });

  it('maps a {content} input to a single user turn plus assistant', () => {
    const { content } = exportDatasetItems([simplePair], 'openai');
    const row = JSON.parse(content.trim());
    expect(row.messages).toEqual([
      { role: 'user', content: 'what is 2+2?' },
      { role: 'assistant', content: '4' },
    ]);
  });

  it('omits the assistant turn when there is no expected output', () => {
    const { content } = exportDatasetItems([noExpected], 'openai');
    const row = JSON.parse(content.trim());
    expect(row.messages).toEqual([{ role: 'user', content: 'just an input' }]);
  });
});

describe('exportDatasetItems — prompt/completion', () => {
  it('emits {prompt, completion} per line', () => {
    const { content } = exportDatasetItems([simplePair], 'prompt-completion');
    expect(JSON.parse(content.trim())).toEqual({ prompt: 'what is 2+2?', completion: '4' });
  });
});

describe('exportDatasetItems — anthropic messages', () => {
  it('includes a top-level system and user/assistant messages', () => {
    const { content } = exportDatasetItems([withMessages], 'anthropic');
    const row = JSON.parse(content.trim());
    expect(row.system).toBe('be nice');
    expect(row.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ]);
  });

  it('omits system when there is no system prompt', () => {
    const { content } = exportDatasetItems([simplePair], 'anthropic');
    const row = JSON.parse(content.trim());
    expect(row.system).toBeUndefined();
  });
});

describe('exportDatasetItems — csv', () => {
  it('emits a header row and escapes embedded quotes/commas', () => {
    const item: ExportableItem = { input: 'a,b "c"', expectedOutput: 'x' };
    const { content, contentType, extension } = exportDatasetItems([item], 'csv');
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe('input,expected_output,metadata');
    expect(lines[1]).toBe('"a,b ""c""","x",""');
    expect(contentType).toBe('text/csv');
    expect(extension).toBe('csv');
  });
});
