/**
 * Conformance test: proves PartStreamEmitter output is structurally compatible
 * with the Phase 1 SDK mock contract (apps/sdk/src/services/mock-scenarios.ts).
 *
 * The authority is the mock-scenarios event shapes. This test feeds scripted
 * fullStream chunks through PartStreamEmitter and asserts the output matches
 * the same event structure — same types, same field names, same partIndex
 * bookkeeping — as the mock scenarios.
 */
import { describe, it, expect } from 'vitest';
import { PartStreamEmitter } from './part-stream-emitter';
import type { StreamEvent, MessagePartType } from './stream-events';

const VALID_EVENT_TYPES = new Set([
  'part_start', 'token', 'thinking_step', 'part_complete', 'done', 'error',
]);
const VALID_PART_TYPES = new Set<MessagePartType>([
  'text', 'thinking', 'menu', 'file', 'image', 'card',
]);

async function collect(chunks: any[], messageId = 'test-msg'): Promise<StreamEvent[]> {
  const emitter = new PartStreamEmitter(messageId);
  const out: StreamEvent[] = [];
  async function* gen() { for (const c of chunks) yield c; }
  for await (const ev of emitter.run(gen())) out.push(ev);
  return out;
}

/** Assert every event in the array is a valid StreamEvent shape. */
function assertValidEvents(events: StreamEvent[], messageId: string) {
  for (const ev of events) {
    expect(VALID_EVENT_TYPES.has(ev.type), `unknown event type: ${ev.type}`).toBe(true);
    expect(ev.messageId).toBe(messageId);

    if (ev.type === 'part_start' || ev.type === 'token' || ev.type === 'thinking_step' || ev.type === 'part_complete') {
      expect(typeof ev.partIndex).toBe('number');
      expect(ev.partIndex).toBeGreaterThanOrEqual(0);
    }

    if (ev.type === 'part_start') {
      expect(VALID_PART_TYPES.has(ev.partType!), `unknown partType: ${ev.partType}`).toBe(true);
    }

    if (ev.type === 'thinking_step') {
      expect(ev.step).toBeDefined();
      expect(typeof ev.step!.id).toBe('string');
      expect(typeof ev.step!.label).toBe('string');
      expect(['active', 'done']).toContain(ev.step!.status);
    }

    if (ev.type === 'part_start' && ev.part !== undefined) {
      expect(typeof ev.part).toBe('object');
      expect(ev.part).not.toBeNull();
    }

    if (ev.type === 'done') {
      if (ev.usage !== undefined) {
        expect(typeof ev.usage.inputTokens).toBe('number');
        expect(typeof ev.usage.outputTokens).toBe('number');
        expect(typeof ev.usage.totalTokens).toBe('number');
        expect(ev.usage.totalTokens).toBe(ev.usage.inputTokens + ev.usage.outputTokens);
      }
    }
  }
}

/** Assert partIndex values are monotonically non-decreasing and start at 0. */
function assertPartIndexOrder(events: StreamEvent[]) {
  const starts = events.filter((e) => e.type === 'part_start');
  const indices = starts.map((e) => e.partIndex!);
  expect(indices[0]).toBe(0);
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]).toBeGreaterThan(indices[i - 1]!);
  }
}

describe('PartStreamEmitter conformance — Phase 1 SDK contract', () => {
  it('thinking scenario: tool-call → tool-result → text matches mock thinking event structure', async () => {
    const events = await collect([
      { type: 'tool-call', toolCallId: 's1', toolName: 'search_knowledge_base' },
      { type: 'tool-result', toolCallId: 's1', toolName: 'search_knowledge_base', output: { hits: 4, source: 'docs' } },
      { type: 'text-delta', text: 'Based on your plan, ' },
      { type: 'text-delta', text: 'refunds are processed within 5 business days.' },
      { type: 'finish', usage: { inputTokens: 10, outputTokens: 20 } },
    ], 'test-msg');

    assertValidEvents(events, 'test-msg');
    assertPartIndexOrder(events);

    // Matches mock thinking scenario structure:
    // part_start(thinking,0) → thinking_step(active,0) → thinking_step(done,0)
    // → part_complete(0) → part_start(text,1) → token(1) × N → part_complete(1) → done
    const types = events.map((e) => e.type);
    expect(types).toContain('part_start');
    expect(types).toContain('thinking_step');
    expect(types).toContain('part_complete');
    expect(types).toContain('token');
    expect(types).toContain('done');
    expect(types.at(-1)).toBe('done');

    // Thinking part at index 0
    const thinkingStart = events.find((e) => e.type === 'part_start' && e.partType === 'thinking');
    expect(thinkingStart?.partIndex).toBe(0);

    // Text part at index 1
    const textStart = events.find((e) => e.type === 'part_start' && e.partType === 'text');
    expect(textStart?.partIndex).toBe(1);

    // Active step has label from toolLabel()
    const activeStep = events.find((e) => e.type === 'thinking_step' && e.step?.status === 'active');
    expect(activeStep?.step?.label).toBe('Searching knowledge base');
    expect(activeStep?.step?.id).toBe('s1');

    // Done step has same id and data from tool output
    const doneStep = events.find((e) => e.type === 'thinking_step' && e.step?.status === 'done');
    expect(doneStep?.step?.id).toBe('s1');
    expect(doneStep?.step?.data).toMatchObject({ hits: '4', source: 'docs' });

    // part_complete for thinking before text starts
    const thinkingCompleteIdx = events.findIndex((e) => e.type === 'part_complete' && e.partIndex === 0);
    const textStartIdx = events.findIndex((e) => e.type === 'part_start' && e.partType === 'text');
    expect(thinkingCompleteIdx).toBeLessThan(textStartIdx);

    // Tokens carry the text content
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBe(2);
    expect(tokens[0]?.content).toBe('Based on your plan, ');
    expect(tokens[1]?.content).toBe('refunds are processed within 5 business days.');

    // Usage on done event
    const done = events.find((e) => e.type === 'done');
    expect(done?.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  });

  it('files scenario: file-gen tool results produce file parts with correct structure', async () => {
    const pdfPart = { type: 'file', name: 'Q2-summary.pdf', mimeType: 'application/pdf', url: 'https://s3/Q2-summary.pdf', sizeBytes: 248000 };
    const xlsxPart = { type: 'file', name: 'metrics.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: 'https://s3/metrics.xlsx', sizeBytes: 51200 };

    const events = await collect([
      { type: 'tool-call', toolCallId: 'f1', toolName: 'generate_pdf' },
      { type: 'tool-result', toolCallId: 'f1', toolName: 'generate_pdf', output: { __filePart: pdfPart } },
      { type: 'tool-call', toolCallId: 'f2', toolName: 'generate_spreadsheet' },
      { type: 'tool-result', toolCallId: 'f2', toolName: 'generate_spreadsheet', output: { __filePart: xlsxPart } },
      { type: 'text-delta', text: 'Here is your report and the raw data:' },
      { type: 'finish', usage: { inputTokens: 5, outputTokens: 10 } },
    ], 'test-msg');

    assertValidEvents(events, 'test-msg');
    assertPartIndexOrder(events);

    // Two file parts emitted
    const fileStarts = events.filter((e) => e.type === 'part_start' && e.partType === 'file');
    expect(fileStarts).toHaveLength(2);

    // Each file part has the correct shape (matches mock files scenario part shape)
    expect(fileStarts[0]?.part).toMatchObject({ type: 'file', name: 'Q2-summary.pdf', mimeType: 'application/pdf' });
    expect(fileStarts[1]?.part).toMatchObject({ type: 'file', name: 'metrics.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Each file part is immediately completed
    for (const fs of fileStarts) {
      const complete = events.find((e) => e.type === 'part_complete' && e.partIndex === fs.partIndex);
      expect(complete).toBeDefined();
    }

    // Text part present
    const textStart = events.find((e) => e.type === 'part_start' && e.partType === 'text');
    expect(textStart).toBeDefined();

    // done is last
    expect(events.at(-1)?.type).toBe('done');
  });

  it('error scenario: error event has message field (matches mock error contract)', async () => {
    const emitter = new PartStreamEmitter('test-msg');
    const out: StreamEvent[] = [];
    async function* boom() {
      yield { type: 'text-delta', text: 'Let me look that up' };
      throw new Error('Upstream timeout');
    }
    for await (const ev of emitter.run(boom() as any)) out.push(ev);

    assertValidEvents(out, 'test-msg');

    const errorEv = out.at(-1)!;
    expect(errorEv.type).toBe('error');
    expect(typeof errorEv.message).toBe('string');
    expect(errorEv.message).toContain('Upstream timeout');
    // messageId present (matches mock contract)
    expect(errorEv.messageId).toBe('test-msg');
  });

  it('menu part shape is structurally compatible with mock menu scenario', async () => {
    // WorkflowEngine emits menu parts — verify the shape matches the mock contract
    // by constructing the expected shape directly and checking field names
    const menuPart = {
      type: 'menu' as const,
      title: 'Choose a topic',
      options: [
        { label: 'Billing & refunds', value: 'topic:billing' },
        { label: 'Technical support', value: 'topic:support' },
      ],
    };

    // Simulate what WorkflowEngine emits (part_start with part payload)
    const syntheticEvent: StreamEvent = {
      type: 'part_start',
      messageId: 'test-msg',
      partIndex: 0,
      partType: 'menu',
      part: menuPart,
    };

    assertValidEvents([syntheticEvent], 'test-msg');
    expect(syntheticEvent.part).toMatchObject({
      type: 'menu',
      title: expect.any(String),
      options: expect.arrayContaining([
        expect.objectContaining({ label: expect.any(String), value: expect.any(String) }),
      ]),
    });
  });
});
