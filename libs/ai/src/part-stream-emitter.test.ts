import { describe, it, expect } from 'vitest';
import { PartStreamEmitter } from './part-stream-emitter';
import type { StreamEvent } from './stream-events';

async function* gen(chunks: any[]) { for (const c of chunks) yield c; }

async function collect(chunks: any[], messageId = 'm1'): Promise<StreamEvent[]> {
  const emitter = new PartStreamEmitter(messageId);
  const out: StreamEvent[] = [];
  for await (const ev of emitter.run(gen(chunks))) out.push(ev);
  return out;
}

describe('PartStreamEmitter', () => {
  it('text-only stream: part_start(text) → tokens → part_complete → done', async () => {
    const ev = await collect([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'finish', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    expect(ev.map((e) => e.type)).toEqual(['part_start', 'token', 'token', 'part_complete', 'done']);
    expect(ev[0].partType).toBe('text');
    expect(ev[0].partIndex).toBe(0);
    expect(ev[1].content).toBe('Hello ');
    expect(ev.at(-1)!.type).toBe('done');
  });

  it('tool call → result → text: thinking part precedes text part with correct indices', async () => {
    const ev = await collect([
      { type: 'tool-call', toolCallId: 't1', toolName: 'search_knowledge_base' },
      { type: 'tool-result', toolCallId: 't1', toolName: 'search_knowledge_base', output: { hits: 4 } },
      { type: 'text-delta', text: 'Based on the docs…' },
      { type: 'finish', usage: { inputTokens: 5, outputTokens: 4 } },
    ]);
    const start0 = ev.find((e) => e.type === 'part_start' && e.partIndex === 0);
    expect(start0!.partType).toBe('thinking');
    const active = ev.find((e) => e.type === 'thinking_step' && e.step?.status === 'active');
    const done = ev.find((e) => e.type === 'thinking_step' && e.step?.status === 'done');
    expect(active!.step!.label).toBe('Searching knowledge base');
    expect(done!.step!.id).toBe(active!.step!.id);
    const completeThinking = ev.find((e) => e.type === 'part_complete' && e.partIndex === 0);
    const start1 = ev.find((e) => e.type === 'part_start' && e.partIndex === 1);
    expect(completeThinking).toBeTruthy();
    expect(start1!.partType).toBe('text');
    expect(ev.at(-1)!.type).toBe('done');
  });

  it('file-gen tool result emits a file part', async () => {
    const filePart = { type: 'file', name: 'r.pdf', mimeType: 'application/pdf', url: 'https://s3/r.pdf', sizeBytes: 10 };
    const ev = await collect([
      { type: 'tool-call', toolCallId: 'f1', toolName: 'generate_pdf' },
      { type: 'tool-result', toolCallId: 'f1', toolName: 'generate_pdf', output: { __filePart: filePart } },
      { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const fileStart = ev.find((e) => e.type === 'part_start' && e.partType === 'file');
    expect(fileStart!.part).toEqual(filePart);
    expect(ev.some((e) => e.type === 'part_complete' && e.partIndex === fileStart!.partIndex)).toBe(true);
  });

  it('mid-stream error emits an error event and preserves accumulated parts', async () => {
    const emitter = new PartStreamEmitter('m1');
    const out: StreamEvent[] = [];
    async function* boom() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('upstream gone');
    }
    for await (const ev of emitter.run(boom() as any)) out.push(ev);
    expect(out.at(-1)!.type).toBe('error');
    expect(out.at(-1)!.message).toContain('upstream gone');
    expect(emitter.parts[0]).toEqual({ type: 'text', text: 'partial' });
  });

  it('exposes accumulated final parts after a clean run', async () => {
    const emitter = new PartStreamEmitter('m1');
    const out: StreamEvent[] = [];
    async function* g() {
      yield { type: 'text-delta', text: 'hi' };
      yield { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } };
    }
    for await (const _ of emitter.run(g() as any)) out.push(_);
    expect(emitter.parts).toEqual([{ type: 'text', text: 'hi' }]);
    expect(emitter.usage).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  });

  it('with showThinking:false, suppresses thinking events and text becomes partIndex 0', async () => {
    async function* g(chunks: any[]) { for (const c of chunks) yield c; }
    const emitter = new PartStreamEmitter('m1', { showThinking: false });
    const out: import('./stream-events').StreamEvent[] = [];
    for await (const ev of emitter.run(g([
      { type: 'tool-call', toolCallId: 't1', toolName: 'search_knowledge_base' },
      { type: 'tool-result', toolCallId: 't1', toolName: 'search_knowledge_base', output: { hits: 4 } },
      { type: 'text-delta', text: 'Answer.' },
      { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } },
    ]))) out.push(ev);
    expect(out.some((e) => e.partType === 'thinking')).toBe(false);
    expect(out.some((e) => e.type === 'thinking_step')).toBe(false);
    const textStart = out.find((e) => e.type === 'part_start' && e.partType === 'text');
    expect(textStart!.partIndex).toBe(0);
    expect(out.at(-1)!.type).toBe('done');
  });
});
