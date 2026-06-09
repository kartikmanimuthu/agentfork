# Chat Widget Backend Protocol (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real inference backend emit the Phase 1 message-parts SSE contract — thinking timelines from real tool steps, server-driven menus from a config workflow tree, and downloadable PDF/spreadsheet artifacts — and persist rich parts on session messages.

**Architecture:** A pure `PartStreamEmitter` in `libs/ai` maps the Vercel AI SDK `fullStream` to `StreamEvent`s (sole owner of `partIndex` bookkeeping). A pure `WorkflowEngine` in `libs/shared` deterministically resolves a config workflow tree before the LLM. The 769-line inference route stays thin: consult engine → else pipe emitter → SSE. File-generation tools render to S3 and surface as `file` parts. All orchestration lives in the libraries where `bunx vitest` runs cleanly.

**Tech Stack:** Vercel AI SDK (`streamText().fullStream`, `TextStreamPart`, `ToolSet`, `tool()`), Zod, Prisma (PostgreSQL), `exceljs` (XLSX), `pdfkit` (PDF), AWS S3 (existing access), Vitest, Pino.

**Test commands:**
- `libs/ai` single file: from repo root, `bunx vitest run libs/ai/src/<file>.test.ts`
- `libs/shared` single file: `bunx vitest run libs/shared/src/<path>/<file>.test.ts`
- All affected: `nx affected -t test`
- Prisma client regen after schema change: `bunx prisma generate --schema=./prisma/schema.prisma`
- Migration (local): `bunx prisma migrate dev --name <name>`

> **Test-harness note:** `libs/ai` and `libs/shared` Vitest specs run cleanly (134 passed in Phase 1). The broken `@stencil/vitest` render() harness is SDK-only and does NOT affect this plan. Write real unit tests for every task here.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `libs/ai/src/stream-events.ts` | Producer-side `StreamEvent` / `MessagePart` types + helpers (mirror SDK contract) |
| Modify | `libs/ai/src/provider.ts` | Add `fullStream` to `StreamChatResult` |
| Create | `libs/ai/src/tool-label.ts` | Humanize a tool name → a thinking-step label |
| Create | `libs/ai/src/tool-label.test.ts` | Tests for the humanizer |
| Create | `libs/ai/src/part-stream-emitter.ts` | Map `fullStream` chunks → `AsyncGenerator<StreamEvent>` (+ accumulate final parts) |
| Create | `libs/ai/src/part-stream-emitter.test.ts` | Keystone tests over a fake fullStream |
| Create | `libs/ai/src/file-generation.ts` | `generate_spreadsheet` / `generate_pdf` tools + S3 uploader interface |
| Create | `libs/ai/src/file-generation.test.ts` | Render + upload with a mocked uploader |
| Modify | `libs/ai/src/index.ts` | Export emitter, file-gen, stream-events, tool-label |
| Create | `libs/shared/src/workflow/workflow-types.ts` | `WorkflowDefinition` Zod schema + types + `WorkflowCursor` |
| Create | `libs/shared/src/workflow/workflow-engine.ts` | `resolve(definition, value, cursor)` deterministic engine |
| Create | `libs/shared/src/workflow/workflow-engine.test.ts` | Engine tests (match, no-match, terminal, cycle guard) |
| Modify | `libs/shared/src/index.ts` | Export workflow types + engine |
| Modify | `prisma/schema.prisma` | `InferenceSessionMessage.parts`, `InferenceSession.workflowState`, new `AgentWorkflow` |
| Modify | `libs/shared/src/services/inference-session-service.ts` | `appendMessage` accepts/persists `parts`; add `setWorkflowState` |
| Create | `libs/shared/src/services/inference-session-service.test.ts` | Tests for parts persistence + workflow-state (injected `SessionDb`) |
| Modify | `apps/web-ui/app/api/v1/inference/route.ts` | Replace SSE block: workflow check → emitter → SSE; persist parts |
| Create | `libs/ai/src/conformance.test.ts` | Emitter output matches Phase 1 `mock-scenarios.ts` shapes |

---

### Task 1: Producer-side stream-event types + expose `fullStream`

**Files:**
- Create: `libs/ai/src/stream-events.ts`
- Modify: `libs/ai/src/provider.ts`

- [ ] **Step 1: Create `libs/ai/src/stream-events.ts`** — the producer mirror of the SDK's `StreamEvent`/`MessagePart` (SDK is the authority at `apps/sdk/src/types/index.ts`; a conformance test in Task 10 pins them together).

```typescript
// libs/ai/src/stream-events.ts
export interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: 'active' | 'done';
  data?: Record<string, string>;
}
export interface MenuOption { label: string; value: string; icon?: string }
export interface CardButton { label: string; url?: string; value?: string }

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] }
  | { type: 'menu'; title?: string; options: MenuOption[] }
  | { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'card'; title: string; description?: string; buttons?: CardButton[] };

export type MessagePartType = MessagePart['type'];

export interface StreamEvent {
  type: 'part_start' | 'token' | 'thinking_step' | 'part_complete' | 'done' | 'error';
  messageId?: string;
  partIndex?: number;
  partType?: MessagePartType;
  content?: string;
  step?: ThinkingStep;
  message?: string;
  part?: MessagePart;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** Serialize one event to an SSE `data:` frame (newline-terminated). */
export function toSseFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
```

- [ ] **Step 2: Expose `fullStream` on `StreamChatResult`.** In `libs/ai/src/provider.ts`, add the `fullStream` field. The Bedrock provider already returns the raw `streamText()` result (which has `fullStream`), so this is a type-only change.

Add the import and field:

```typescript
import type { ModelMessage, LanguageModelUsage, ToolSet, TextStreamPart } from 'ai';
```

In `interface StreamChatResult`, add after `textStream`:

```typescript
  /** Full typed event stream: text-delta, tool-call, tool-result, finish, error, … */
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>;
```

- [ ] **Step 3: Verify it compiles.** Run: `bunx tsc -p libs/ai/tsconfig.lib.json --noEmit` (or `nx build ai`). Expected: no errors. The Bedrock `streamText()` result structurally already has `fullStream`, so no provider implementation change is needed.

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/stream-events.ts libs/ai/src/provider.ts
git commit -m "feat(ai): add stream-event types and expose fullStream"
```

---

### Task 2: Tool-name → label humanizer

**Files:**
- Create: `libs/ai/src/tool-label.ts`
- Create: `libs/ai/src/tool-label.test.ts`

- [ ] **Step 1: Write the failing test** (`tool-label.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { toolLabel } from './tool-label';

describe('toolLabel', () => {
  it('snake_case → sentence case', () => {
    expect(toolLabel('search_knowledge_base')).toBe('Searching knowledge base');
  });
  it('camelCase → sentence case', () => {
    expect(toolLabel('searchOrders')).toBe('Searching orders');
  });
  it('maps a known verb prefix to its gerund', () => {
    expect(toolLabel('get_account')).toBe('Getting account');
  });
  it('falls back gracefully for an unknown shape', () => {
    expect(toolLabel('foo')).toBe('Running foo');
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/ai/src/tool-label.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `tool-label.ts`**

```typescript
// libs/ai/src/tool-label.ts
const GERUND: Record<string, string> = {
  search: 'Searching', get: 'Getting', fetch: 'Fetching', list: 'Listing',
  create: 'Creating', update: 'Updating', delete: 'Deleting', send: 'Sending',
  generate: 'Generating', query: 'Querying', lookup: 'Looking up', find: 'Finding',
};

export function toolLabel(toolName: string): string {
  const words = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Working';
  const [first, ...rest] = words;
  const verb = GERUND[first];
  if (verb) return rest.length ? `${verb} ${rest.join(' ')}` : verb;
  return `Running ${words.join(' ')}`;
}
```

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/ai/src/tool-label.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/ai/src/tool-label.ts libs/ai/src/tool-label.test.ts
git commit -m "feat(ai): add tool-name humanizer for thinking-step labels"
```

---

### Task 3: PartStreamEmitter (keystone)

**Files:**
- Create: `libs/ai/src/part-stream-emitter.ts`
- Create: `libs/ai/src/part-stream-emitter.test.ts`

The emitter consumes the AI SDK `fullStream` and yields `StreamEvent`s, owning all `partIndex` bookkeeping. It also accumulates the final `MessagePart[]` for persistence. A tool is a "file-gen" tool if its `tool-result` output has `{ __filePart: FilePart }` (the file-gen tools in Task 4 return this shape).

- [ ] **Step 1: Write the failing test** (`part-stream-emitter.test.ts`). Uses a fake fullStream (an async generator of chunk objects mirroring `TextStreamPart`).

```typescript
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
    // thinking part opens at index 0
    const start0 = ev.find((e) => e.type === 'part_start' && e.partIndex === 0);
    expect(start0!.partType).toBe('thinking');
    // a step goes active then done
    const active = ev.find((e) => e.type === 'thinking_step' && e.step?.status === 'active');
    const done = ev.find((e) => e.type === 'thinking_step' && e.step?.status === 'done');
    expect(active!.step!.label).toBe('Searching knowledge base');
    expect(done!.step!.id).toBe(active!.step!.id);
    // thinking completes, then text part opens at index 1
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
    // file part is completed
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
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/ai/src/part-stream-emitter.test.ts` → FAIL.

- [ ] **Step 3: Implement `part-stream-emitter.ts`**

```typescript
// libs/ai/src/part-stream-emitter.ts
import type { StreamEvent, MessagePart, ThinkingStep } from './stream-events';
import { toolLabel } from './tool-label';

interface FinishUsage { inputTokens?: number; outputTokens?: number }

export class PartStreamEmitter {
  /** Accumulated parts for persistence (populated as the stream is consumed). */
  readonly parts: MessagePart[] = [];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

  private thinkingIndex: number | null = null;
  private textIndex: number | null = null;
  private stepByToolCallId = new Map<string, string>();

  constructor(private readonly messageId: string) {}

  private startEvent(partType: MessagePart['type'], part?: MessagePart): StreamEvent {
    const partIndex = this.parts.length;
    this.parts.push(part ?? this.seed(partType));
    return { type: 'part_start', messageId: this.messageId, partIndex, partType, ...(part ? { part } : {}) };
  }

  private seed(t: MessagePart['type']): MessagePart {
    if (t === 'text') return { type: 'text', text: '' };
    if (t === 'thinking') return { type: 'thinking', status: 'active', steps: [] };
    // file/image/menu/card are always provided fully via `part`
    return { type: 'text', text: '' };
  }

  async *run(fullStream: AsyncIterable<any>): AsyncGenerator<StreamEvent> {
    try {
      for await (const chunk of fullStream) {
        switch (chunk.type) {
          case 'tool-call': {
            const out = this.onToolCall(chunk);
            for (const e of out) yield e;
            break;
          }
          case 'tool-result': {
            const out = this.onToolResult(chunk);
            for (const e of out) yield e;
            break;
          }
          case 'text-delta': {
            const out = this.onTextDelta(chunk.text ?? chunk.textDelta ?? '');
            for (const e of out) yield e;
            break;
          }
          case 'finish': {
            for (const e of this.onFinish(chunk.usage)) yield e;
            break;
          }
          case 'error': {
            yield this.errorEvent(String(chunk.error ?? 'stream error'));
            return;
          }
          default:
            break; // ignore step-start/step-finish/reasoning/etc. for Phase 2
        }
      }
    } catch (err) {
      yield this.errorEvent(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  private onToolCall(chunk: { toolCallId: string; toolName: string }): StreamEvent[] {
    const events: StreamEvent[] = [];
    // Skip thinking UI for file-gen tools — their RESULT produces a file part directly.
    if (isFileGenTool(chunk.toolName)) return events;
    if (this.thinkingIndex === null) {
      events.push(this.startEvent('thinking'));
      this.thinkingIndex = this.parts.length - 1;
    }
    const stepId = chunk.toolCallId;
    const step: ThinkingStep = { id: stepId, label: toolLabel(chunk.toolName), status: 'active' };
    (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).steps.push(step);
    this.stepByToolCallId.set(chunk.toolCallId, stepId);
    events.push({ type: 'thinking_step', messageId: this.messageId, partIndex: this.thinkingIndex, step });
    return events;
  }

  private onToolResult(chunk: { toolCallId: string; toolName: string; output?: any }): StreamEvent[] {
    const events: StreamEvent[] = [];
    // File-gen tool: its output carries a ready file part.
    const filePart = chunk.output?.__filePart as MessagePart | undefined;
    if (filePart && filePart.type === 'file') {
      if (this.thinkingIndex !== null) {
        events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.thinkingIndex });
        (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).status = 'done';
        this.thinkingIndex = null;
      }
      events.push(this.startEvent('file', filePart));
      const idx = this.parts.length - 1;
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: idx });
      return events;
    }
    // Regular tool: mark the matching step done, attach compact data.
    const stepId = this.stepByToolCallId.get(chunk.toolCallId);
    if (stepId !== null && this.thinkingIndex !== null) {
      const thinking = this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>;
      const step = thinking.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = 'done';
        const data = compactData(chunk.output);
        if (data) step.data = data;
        events.push({ type: 'thinking_step', messageId: this.messageId, partIndex: this.thinkingIndex, step: { ...step } });
      }
    }
    return events;
  }

  private onTextDelta(text: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.thinkingIndex !== null) {
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.thinkingIndex });
      (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).status = 'done';
      this.thinkingIndex = null;
    }
    if (this.textIndex === null) {
      events.push(this.startEvent('text'));
      this.textIndex = this.parts.length - 1;
    }
    (this.parts[this.textIndex] as Extract<MessagePart, { type: 'text' }>).text += text;
    events.push({ type: 'token', messageId: this.messageId, partIndex: this.textIndex, content: text });
    return events;
  }

  private onFinish(usage?: FinishUsage): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.textIndex !== null) {
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.textIndex });
      this.textIndex = null;
    } else if (this.thinkingIndex !== null) {
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.thinkingIndex });
      (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).status = 'done';
      this.thinkingIndex = null;
    }
    const i = usage?.inputTokens ?? 0;
    const o = usage?.outputTokens ?? 0;
    this.usage = { inputTokens: i, outputTokens: o, totalTokens: i + o };
    events.push({ type: 'done', messageId: this.messageId, usage: this.usage });
    return events;
  }

  private errorEvent(message: string): StreamEvent {
    return { type: 'error', messageId: this.messageId, message };
  }
}

export function isFileGenTool(toolName: string): boolean {
  return toolName === 'generate_spreadsheet' || toolName === 'generate_pdf';
}

/** Turn a tool-result object into ≤4 short string key/values for a thinking-step data card. */
function compactData(output: unknown): Record<string, string> | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const entries = Object.entries(output as Record<string, unknown>)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
```

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/ai/src/part-stream-emitter.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/ai/src/part-stream-emitter.ts libs/ai/src/part-stream-emitter.test.ts
git commit -m "feat(ai): add PartStreamEmitter mapping fullStream to parts contract"
```

---

### Task 4: File-generation tools

**Files:**
- Create: `libs/ai/src/file-generation.ts`
- Create: `libs/ai/src/file-generation.test.ts`

Install deps first: from repo root, `bun add exceljs pdfkit && bun add -d @types/pdfkit`.

The tools accept an injected `FileUploader` (mirrors the existing `FileDownloader` in `content-resolver.ts`) so they're unit-testable without S3. Each tool's `execute` returns `{ __filePart: FilePart }` — the shape `PartStreamEmitter` (Task 3) recognizes.

- [ ] **Step 1: Write the failing test** (`file-generation.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createFileGenerationTools, type FileUploader } from './file-generation';

function fakeUploader(): FileUploader {
  return {
    upload: vi.fn(async (key: string, _buf: Buffer, _mime: string) => `https://s3.example/${key}`),
  };
}

describe('file-generation tools', () => {
  it('generate_spreadsheet uploads an xlsx and returns a file part', async () => {
    const up = fakeUploader();
    const tools = createFileGenerationTools(up);
    const res: any = await tools.generate_spreadsheet.execute(
      { filename: 'metrics', columns: ['A', 'B'], rows: [['1', '2']] },
      { toolCallId: 't', messages: [] } as any,
    );
    expect(up.upload).toHaveBeenCalledOnce();
    expect(res.__filePart.type).toBe('file');
    expect(res.__filePart.name).toBe('metrics.xlsx');
    expect(res.__filePart.mimeType).toContain('spreadsheetml');
    expect(res.__filePart.url).toContain('https://s3.example/');
    expect(res.__filePart.sizeBytes).toBeGreaterThan(0);
  });

  it('generate_pdf uploads a pdf and returns a file part', async () => {
    const up = fakeUploader();
    const tools = createFileGenerationTools(up);
    const res: any = await tools.generate_pdf.execute(
      { filename: 'report', title: 'Q2', sections: [{ heading: 'Intro', body: 'Hello' }] },
      { toolCallId: 't', messages: [] } as any,
    );
    expect(res.__filePart.type).toBe('file');
    expect(res.__filePart.name).toBe('report.pdf');
    expect(res.__filePart.mimeType).toBe('application/pdf');
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/ai/src/file-generation.test.ts` → FAIL.

- [ ] **Step 3: Implement `file-generation.ts`**

```typescript
// libs/ai/src/file-generation.ts
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { MessagePart } from './stream-events';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface FileUploader {
  /** Upload bytes and return a download URL (signed/TTL-bounded in production). */
  upload(key: string, bytes: Buffer, mimeType: string): Promise<string>;
}

type FilePart = Extract<MessagePart, { type: 'file' }>;

function filePartResult(part: FilePart) {
  return { __filePart: part };
}

async function renderXlsx(columns: string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  if (columns.length) ws.addRow(columns);
  for (const r of rows) ws.addRow(r);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function renderPdf(title: string, sections: { heading: string; body: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).text(title);
    doc.moveDown();
    for (const s of sections) {
      doc.fontSize(14).text(s.heading);
      doc.fontSize(11).text(s.body);
      doc.moveDown();
    }
    doc.end();
  });
}

/** Sanitize a user-supplied filename stem (no path separators, bounded length). */
function safeStem(name: string): string {
  const stem = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return stem || 'document';
}

export function createFileGenerationTools(uploader: FileUploader): ToolSet {
  return {
    generate_spreadsheet: tool({
      description: 'Generate a downloadable .xlsx spreadsheet from columns and rows.',
      inputSchema: z.object({
        filename: z.string().min(1),
        columns: z.array(z.string()).default([]),
        rows: z.array(z.array(z.string())).default([]),
      }),
      execute: async ({ filename, columns, rows }) => {
        const stem = safeStem(filename);
        const bytes = await renderXlsx(columns, rows);
        const key = `generated/${stem}-${bytes.length}.xlsx`;
        const url = await uploader.upload(key, bytes, XLSX_MIME);
        return filePartResult({ type: 'file', name: `${stem}.xlsx`, mimeType: XLSX_MIME, url, sizeBytes: bytes.length });
      },
    }),
    generate_pdf: tool({
      description: 'Generate a downloadable PDF document from a title and sections.',
      inputSchema: z.object({
        filename: z.string().min(1),
        title: z.string().default(''),
        sections: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
      }),
      execute: async ({ filename, title, sections }) => {
        const stem = safeStem(filename);
        const bytes = await renderPdf(title, sections);
        const key = `generated/${stem}-${bytes.length}.pdf`;
        const url = await uploader.upload(key, bytes, 'application/pdf');
        return filePartResult({ type: 'file', name: `${stem}.pdf`, mimeType: 'application/pdf', url, sizeBytes: bytes.length });
      },
    }),
  };
}
```

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/ai/src/file-generation.test.ts` → PASS (2 tests). If `pdfkit` needs font files in the test env and errors, keep the PDF test but stub fonts via `new PDFDocument({ font: 'Helvetica' })` (Helvetica is built-in, no file needed).

- [ ] **Step 5: Commit**

```bash
git add libs/ai/src/file-generation.ts libs/ai/src/file-generation.test.ts package.json
git commit -m "feat(ai): add generate_spreadsheet and generate_pdf file tools"
```

---

### Task 5: Export the new `libs/ai` surface

**Files:**
- Modify: `libs/ai/src/index.ts`

- [ ] **Step 1: Add exports** at the end of `libs/ai/src/index.ts`:

```typescript
export {
  type StreamEvent,
  type MessagePart,
  type MessagePartType,
  type ThinkingStep,
  type MenuOption,
  type CardButton,
  toSseFrame,
} from './stream-events';
export { PartStreamEmitter, isFileGenTool } from './part-stream-emitter';
export { toolLabel } from './tool-label';
export { createFileGenerationTools, type FileUploader } from './file-generation';
```

- [ ] **Step 2: Verify build.** `nx build ai` (or `bunx tsc -p libs/ai/tsconfig.lib.json --noEmit`) → no errors.

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/index.ts
git commit -m "chore(ai): export Phase 2 emitter, file tools, and stream-event types"
```

---

### Task 6: Workflow types + Zod schema

**Files:**
- Create: `libs/shared/src/workflow/workflow-types.ts`

- [ ] **Step 1: Create `workflow-types.ts`** (the authoritative contract Phase 3 authors against).

```typescript
// libs/shared/src/workflow/workflow-types.ts
import { z } from 'zod';

export const menuOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  icon: z.string().optional(),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('menu'), title: z.string().optional(), options: z.array(menuOptionSchema).min(1) }),
  z.object({ id: z.string().min(1), type: z.literal('text'), text: z.string().min(1) }),
  z.object({ id: z.string().min(1), type: z.literal('file'), fileRef: z.string().min(1) }),
]);

export const workflowTransitionSchema = z.object({
  fromNodeId: z.string().min(1),
  optionValue: z.string().min(1),
  toNodeId: z.string().min(1),
});

export const workflowDefinitionSchema = z.object({
  entryNodeId: z.string().min(1),
  nodes: z.array(workflowNodeSchema).min(1),
  transitions: z.array(workflowTransitionSchema).default([]),
});

export type MenuOption = z.infer<typeof menuOptionSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export interface WorkflowCursor { nodeId: string }

/** A static `file` node references a pre-uploaded file by key/url. The engine
 *  resolves a fileRef to a file part via this resolver (injected). */
export interface FileRefResolver {
  resolve(fileRef: string): { name: string; mimeType: string; url: string; sizeBytes?: number };
}
```

- [ ] **Step 2: Verify it compiles.** `bunx tsc -p libs/shared/tsconfig.lib.json --noEmit` → no errors.

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/workflow/workflow-types.ts
git commit -m "feat(shared): add workflow definition schema and types"
```

---

### Task 7: WorkflowEngine

**Files:**
- Create: `libs/shared/src/workflow/workflow-engine.ts`
- Create: `libs/shared/src/workflow/workflow-engine.test.ts`

The engine emits `StreamEvent`s for a resolved node. It imports the producer `StreamEvent`/`MessagePart` types from `@chatbot/ai`.

- [ ] **Step 1: Write the failing test** (`workflow-engine.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from './workflow-engine';
import type { WorkflowDefinition, FileRefResolver } from './workflow-types';

const def: WorkflowDefinition = {
  entryNodeId: 'root',
  nodes: [
    { id: 'root', type: 'menu', title: 'Pick', options: [
      { label: 'Billing', value: 'billing' },
      { label: 'Support', value: 'support' },
    ] },
    { id: 'billingMenu', type: 'menu', title: 'Billing', options: [{ label: 'Refund', value: 'refund' }] },
    { id: 'supportText', type: 'text', text: 'Describe your issue.' },
    { id: 'refundDone', type: 'text', text: 'Refund started.' },
  ],
  transitions: [
    { fromNodeId: 'root', optionValue: 'billing', toNodeId: 'billingMenu' },
    { fromNodeId: 'root', optionValue: 'support', toNodeId: 'supportText' },
    { fromNodeId: 'billingMenu', optionValue: 'refund', toNodeId: 'refundDone' },
  ],
};

const fileResolver: FileRefResolver = { resolve: (ref) => ({ name: ref, mimeType: 'application/pdf', url: `https://s3/${ref}` }) };

describe('WorkflowEngine', () => {
  const engine = new WorkflowEngine(fileResolver);

  it('no cursor: emits the entry node and sets cursor', () => {
    const r = engine.resolve(def, '', null);
    expect(r).not.toBeNull();
    expect(r!.nextCursor).toEqual({ nodeId: 'root' });
    const start = r!.events.find((e) => e.type === 'part_start');
    expect(start!.part?.type).toBe('menu');
  });

  it('matches a transition value and advances the cursor', () => {
    const r = engine.resolve(def, 'billing', { nodeId: 'root' });
    expect(r!.nextCursor).toEqual({ nodeId: 'billingMenu' });
    expect(r!.events.find((e) => e.partType === 'menu')!.part?.type).toBe('menu');
  });

  it('terminal text node clears the cursor (workflow ends)', () => {
    const r = engine.resolve(def, 'refund', { nodeId: 'billingMenu' });
    expect(r!.nextCursor).toBeNull(); // refundDone has no outgoing transitions
    expect(r!.events.some((e) => e.partType === 'text')).toBe(true);
    expect(r!.events.at(-1)!.type).toBe('done');
  });

  it('no matching transition returns null (defer to LLM)', () => {
    const r = engine.resolve(def, 'totally-unknown', { nodeId: 'root' });
    expect(r).toBeNull();
  });

  it('malformed cursor (missing node) returns null', () => {
    const r = engine.resolve(def, 'x', { nodeId: 'ghost' });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/shared/src/workflow/workflow-engine.test.ts` → FAIL.

- [ ] **Step 3: Implement `workflow-engine.ts`**

```typescript
// libs/shared/src/workflow/workflow-engine.ts
import type { StreamEvent, MessagePart } from '@chatbot/ai';
import type { WorkflowDefinition, WorkflowNode, WorkflowCursor, FileRefResolver } from './workflow-types';

export interface WorkflowResolution {
  events: StreamEvent[];
  nextCursor: WorkflowCursor | null;
}

const MOCK_MSG = 'wf'; // messageId placeholder; the route maps events onto the real id

export class WorkflowEngine {
  constructor(private readonly fileResolver: FileRefResolver) {}

  /**
   * Resolve the next workflow step.
   * - cursor null → emit the entry node.
   * - cursor set → follow the transition keyed by `incomingValue`.
   * Returns null when the engine should defer to the LLM (no match / malformed).
   */
  resolve(def: WorkflowDefinition, incomingValue: string, cursor: WorkflowCursor | null): WorkflowResolution | null {
    let targetNode: WorkflowNode | undefined;

    if (cursor === null) {
      targetNode = def.nodes.find((n) => n.id === def.entryNodeId);
      if (!targetNode) return null;
    } else {
      const fromExists = def.nodes.some((n) => n.id === cursor.nodeId);
      if (!fromExists) return null;
      const transition = def.transitions.find((t) => t.fromNodeId === cursor.nodeId && t.optionValue === incomingValue);
      if (!transition) return null;
      targetNode = def.nodes.find((n) => n.id === transition.toNodeId);
      if (!targetNode) return null;
    }

    const part = this.nodeToPart(targetNode);
    if (!part) return null;

    const hasOutgoing = def.transitions.some((t) => t.fromNodeId === targetNode!.id);
    const events: StreamEvent[] = [
      { type: 'part_start', messageId: MOCK_MSG, partIndex: 0, partType: part.type, part },
      { type: 'part_complete', messageId: MOCK_MSG, partIndex: 0 },
      { type: 'done', messageId: MOCK_MSG },
    ];
    return { events, nextCursor: hasOutgoing ? { nodeId: targetNode.id } : null };
  }

  private nodeToPart(node: WorkflowNode): MessagePart | null {
    if (node.type === 'menu') return { type: 'menu', title: node.title, options: node.options };
    if (node.type === 'text') return { type: 'text', text: node.text };
    if (node.type === 'file') {
      const f = this.fileResolver.resolve(node.fileRef);
      return { type: 'file', name: f.name, mimeType: f.mimeType, url: f.url, sizeBytes: f.sizeBytes };
    }
    return null;
  }
}
```

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/shared/src/workflow/workflow-engine.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/workflow/workflow-engine.ts libs/shared/src/workflow/workflow-engine.test.ts
git commit -m "feat(shared): add deterministic WorkflowEngine"
```

---

### Task 8: Prisma schema — parts, workflowState, AgentWorkflow

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `parts` to `InferenceSessionMessage`.** In the `model InferenceSessionMessage` block, add after `attachments`:

```prisma
  parts       Json?     @default("[]")
```

- [ ] **Step 2: Add `workflowState` to `InferenceSession`.** In the `model InferenceSession` block, add after `channelMetadata`:

```prisma
  workflowState   Json?
```

- [ ] **Step 3: Add the `AgentWorkflow` model.** Append near the other agent-related models:

```prisma
model AgentWorkflow {
  id         String   @id @default(cuid())
  agentId    String
  tenantId   String
  version    Int      @default(1)
  isActive   Boolean  @default(false)
  definition Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([agentId, isActive])
  @@map("agent_workflows")
}
```

- [ ] **Step 4: Generate client + migrate.**

```bash
bunx prisma generate --schema=./prisma/schema.prisma
bunx prisma migrate dev --name phase2_parts_workflow
```

Expected: a new migration under `prisma/migrations/`, client regenerated, no errors. If the local DB isn't running, `docker compose up -d` first.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add message parts, session workflowState, AgentWorkflow"
```

---

### Task 9: Persist parts + workflow state in the service

**Files:**
- Modify: `libs/shared/src/services/inference-session-service.ts`
- Create: `libs/shared/src/services/inference-session-service.test.ts`

- [ ] **Step 1: Write the failing test** (`inference-session-service.test.ts`). Uses an in-memory fake `SessionDb`.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { InferenceSessionService, type SessionDb } from './inference-session-service';

function fakeDb(): SessionDb & { _msgs: any[] } {
  const session = { id: 's1', status: 'active', idleExpiresAt: new Date(Date.now() + 60000), messages: [] } as any;
  const _msgs: any[] = [];
  return {
    _msgs,
    inferenceSession: {
      create: vi.fn(),
      findFirst: vi.fn(async () => session),
      findMany: vi.fn(),
      update: vi.fn(async () => session),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(),
    },
    inferenceSessionMessage: {
      create: vi.fn(async ({ data }: any) => { const row = { id: `m${_msgs.length}`, ...data }; _msgs.push(row); return row; }),
    },
  } as any;
}

describe('InferenceSessionService parts + workflowState', () => {
  it('appendMessage persists parts', async () => {
    const db = fakeDb();
    const svc = new InferenceSessionService(db);
    await svc.appendMessage('s1', {
      role: 'assistant',
      content: 'hi',
      parts: [{ type: 'text', text: 'hi' }],
    });
    expect(db._msgs[0].parts).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('setWorkflowState writes the cursor onto the session', async () => {
    const db = fakeDb();
    const svc = new InferenceSessionService(db);
    await svc.setWorkflowState('s1', { nodeId: 'billingMenu' });
    expect(db.inferenceSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { workflowState: { nodeId: 'billingMenu' } },
    });
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/shared/src/services/inference-session-service.test.ts` → FAIL (`parts` not persisted; `setWorkflowState` missing).

- [ ] **Step 3: Extend the service.** In `inference-session-service.ts`:

Add `parts` to `SessionMessageInput`:

```typescript
export interface SessionMessageInput {
  role: string;
  content: string;
  tokenCount?: number;
  attachments?: import('@chatbot/ai').MessageAttachment[];
  parts?: unknown[];
}
```

In `appendMessage`, add `parts` to the create `data` (after `attachments`):

```typescript
        parts: message.parts ? (message.parts as unknown as import('@prisma/client').Prisma.InputJsonValue) : undefined,
```

Add a new method (after `appendMessage`):

```typescript
  /** Persist the workflow cursor (or clear it with null) on the session. */
  async setWorkflowState(id: string, cursor: Record<string, unknown> | null): Promise<void> {
    await this.db.inferenceSession.update({
      where: { id },
      data: { workflowState: cursor as import('@prisma/client').Prisma.InputJsonValue | null },
    });
  }
```

Also extend the `SessionDb.inferenceSessionMessage.create` and record types to carry `parts` (add `parts?: unknown` to `SessionMessageRecord`).

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/shared/src/services/inference-session-service.test.ts` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/services/inference-session-service.ts libs/shared/src/services/inference-session-service.test.ts
git commit -m "feat(shared): persist message parts and session workflow state"
```

---

### Task 10: Export workflow surface + conformance test

**Files:**
- Modify: `libs/shared/src/index.ts`
- Create: `libs/ai/src/conformance.test.ts`

- [ ] **Step 1: Export the workflow surface.** Add to `libs/shared/src/index.ts`:

```typescript
export {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowTransition,
  type WorkflowCursor,
  type FileRefResolver,
} from './workflow/workflow-types';
export { WorkflowEngine, type WorkflowResolution } from './workflow/workflow-engine';
```

- [ ] **Step 2: Write the conformance test** (`libs/ai/src/conformance.test.ts`). It proves the emitter's event SHAPES match what the Phase 1 SDK mock emits for the thinking and files scenarios. (Structural — field names and value types — not timing.)

```typescript
import { describe, it, expect } from 'vitest';
import { PartStreamEmitter } from './part-stream-emitter';
import type { StreamEvent } from './stream-events';

async function* gen(chunks: any[]) { for (const c of chunks) yield c; }
async function run(chunks: any[]): Promise<StreamEvent[]> {
  const e = new PartStreamEmitter('m'); const out: StreamEvent[] = [];
  for await (const ev of e.run(gen(chunks))) out.push(ev);
  return out;
}

// The SDK contract (apps/sdk/src/types/index.ts) requires these exact event types
// and part types. This test fails if the emitter drifts from the Phase 1 contract.
describe('conformance with Phase 1 SDK contract', () => {
  it('thinking scenario shape: part_start(thinking) → thinking_step(active/done) → part_complete → text → done', async () => {
    const ev = await run([
      { type: 'tool-call', toolCallId: 't1', toolName: 'search_knowledge_base' },
      { type: 'tool-result', toolCallId: 't1', toolName: 'search_knowledge_base', output: { hits: 4 } },
      { type: 'text-delta', text: 'Answer.' },
      { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const types = ev.map((e) => e.type);
    expect(types).toContain('part_start');
    expect(types).toContain('thinking_step');
    expect(types).toContain('part_complete');
    expect(types).toContain('done');
    const thinkingStart = ev.find((e) => e.type === 'part_start' && e.partType === 'thinking');
    expect(thinkingStart).toBeTruthy();
    // every event carries messageId; part events carry numeric partIndex
    for (const e of ev) {
      expect(typeof e.messageId).toBe('string');
      if (['part_start', 'token', 'thinking_step', 'part_complete'].includes(e.type)) {
        expect(typeof e.partIndex).toBe('number');
      }
    }
  });

  it('files scenario shape: file part_start carries a full file part payload', async () => {
    const filePart = { type: 'file', name: 'r.pdf', mimeType: 'application/pdf', url: 'https://s3/r.pdf', sizeBytes: 5 };
    const ev = await run([
      { type: 'text-delta', text: 'Here:' },
      { type: 'tool-call', toolCallId: 'f1', toolName: 'generate_pdf' },
      { type: 'tool-result', toolCallId: 'f1', toolName: 'generate_pdf', output: { __filePart: filePart } },
      { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const fileStart = ev.find((e) => e.type === 'part_start' && e.partType === 'file');
    expect(fileStart!.part).toMatchObject({ type: 'file', name: 'r.pdf', mimeType: 'application/pdf', url: expect.any(String) });
  });
});
```

- [ ] **Step 3: Run both.** `bunx vitest run libs/ai/src/conformance.test.ts` → PASS (2 tests). `nx build shared` → no errors.

- [ ] **Step 4: Commit**

```bash
git add libs/shared/src/index.ts libs/ai/src/conformance.test.ts
git commit -m "test(ai): conformance with Phase 1 contract; export workflow surface"
```

---

### Task 11: Wire the inference route

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts`

This replaces the SSE block (currently ~L469–550). It adds: a workflow pre-check, the file-gen tools into the toolset, and the emitter in place of the `textStream` loop. An S3 `FileUploader` adapter is constructed from the same S3 access the app already uses for uploads (mirror however `content-resolver`'s downloader is built in this route — search the file for the S3 client construction and reuse it).

- [ ] **Step 1: Add imports** near the top of the route file:

```typescript
import { PartStreamEmitter, createFileGenerationTools, toSseFrame, type FileUploader } from '@chatbot/ai';
import { WorkflowEngine, workflowDefinitionSchema, type WorkflowCursor } from '@chatbot/shared';
```

- [ ] **Step 2: Build an S3 `FileUploader` + `FileRefResolver`.** Just before the `if (stream && sseFormat)` block, add a helper that wraps the app's S3 client (reuse the existing S3 setup in this route/app — the same credentials the downloader uses):

```typescript
      // S3 uploader for generated artifacts. Reuse the app's existing S3 client/bucket.
      const fileUploader: FileUploader = {
        async upload(key, bytes, mimeType) {
          await s3PutObject(key, bytes, mimeType);       // existing/app S3 put helper
          return await s3SignedUrl(key, 3600);            // existing/app signed-url helper (1h TTL)
        },
      };
      const fileRefResolver = { resolve: (ref: string) => ({ name: ref.split('/').pop() ?? ref, mimeType: 'application/octet-stream', url: '' /* signed at read */ }) };
```

> If the app has no existing `s3PutObject`/`s3SignedUrl` helpers, add a minimal one in `libs/shared` (or reuse `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` the same way the downloader does). Keep it out of this route file if it grows beyond ~15 lines.

- [ ] **Step 3: Load the active workflow + cursor** (inside the `if (stream && sseFormat)` block, before constructing the stream):

```typescript
        const workflowRow = await db.agentWorkflow.findFirst({ where: { agentId, isActive: true }, orderBy: { version: 'desc' } });
        const workflowDef = workflowRow ? workflowDefinitionSchema.safeParse(workflowRow.definition) : null;
        const sessionRow = sessionId ? await db.inferenceSession.findFirst({ where: { id: sessionId } }) : null;
        const cursor = (sessionRow?.workflowState ?? null) as WorkflowCursor | null;
        const incomingValue = userQuery.trim();
```

- [ ] **Step 4: Replace the stream body.** Inside `new ReadableStream({ async start(controller) { ... } })`, replace the `streamChat` + `textStream` loop with: workflow check first, else emitter. Keep all surrounding execution-tracking / webhook / quota logic.

```typescript
          try {
            // 1) Workflow path — deterministic, no LLM.
            if (workflowDef?.success) {
              const engine = new WorkflowEngine(fileRefResolver);
              const resolution = engine.resolve(workflowDef.data, incomingValue, cursor);
              if (resolution) {
                const messageId = sessionId ? `wf_${Date.now()}` : undefined;
                const parts: unknown[] = [];
                for (const ev of resolution.events) {
                  const out = { ...ev, ...(messageId ? { messageId } : {}) };
                  if (ev.type === 'part_start' && ev.part) parts.push(ev.part);
                  controller.enqueue(encoder.encode(toSseFrame(out)));
                }
                if (sessionId) {
                  await sessionService.appendMessage(sessionId, {
                    role: 'assistant',
                    content: parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n'),
                    parts,
                  });
                  await sessionService.setWorkflowState(sessionId, resolution.nextCursor);
                }
                await mcpCleanup();
                await db.apiKeyExecution.update({ where: { id: executionId }, data: { status: 'completed', output: { parts } as any, completedAt: new Date() } });
                controller.close();
                return;
              }
            }

            // 2) LLM path — emitter over fullStream, with file-gen tools added.
            const toolset = { ...(hasMcpTools ? mcpTools : {}), ...createFileGenerationTools(fileUploader) };
            const llm = streamChat({
              provider, messages: coreMessages, model: effectiveModel, system: effectiveSystem,
              temperature: effectiveTemperature, maxOutputTokens: effectiveMaxTokens,
              tools: toolset, maxSteps: 5,
            });

            const messageId = sessionId ? `a_${Date.now()}` : `a_${executionId}`;
            const emitter = new PartStreamEmitter(messageId);
            for await (const ev of emitter.run(llm.fullStream)) {
              controller.enqueue(encoder.encode(toSseFrame(ev)));
            }

            await mcpCleanup();
            const usage = emitter.usage;
            if (usage) await quotaService.incrementUsage(usage.totalTokens);
            const textContent = emitter.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
            if (sessionId) {
              await sessionService.appendMessage(sessionId, { role: 'assistant', content: textContent, parts: emitter.parts, tokenCount: usage?.outputTokens });
              await sessionService.setWorkflowState(sessionId, null); // free-text turn ends any workflow
            }
            await db.apiKeyExecution.update({ where: { id: executionId }, data: { status: 'completed', output: { text: textContent, parts: emitter.parts } as any, tokenUsage: (usage ?? null) as any, completedAt: new Date() } });
            await deliverWebhook('completed', { text: textContent }, undefined, usage, Date.now() - startedAt.getTime());
            controller.close();
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await mcpCleanup();
            await db.apiKeyExecution.update({ where: { id: executionId }, data: { status: 'failed', output: { error: error.message }, completedAt: new Date() } }).catch(() => {});
            await deliverWebhook('failed', undefined, error.message).catch(() => {});
            controller.enqueue(encoder.encode(toSseFrame({ type: 'error', message: error.message })));
            controller.close();
          }
```

> Note: the emitter emits its own `done` event on `finish`; do NOT also enqueue the old `{type:'done'}` frame. Remove the old `fullText`/`textStream` lines entirely.

- [ ] **Step 5: Typecheck the route.** `nx build web-ui` (or `bunx tsc --noEmit` scoped to web-ui). Fix any type gaps (e.g. `db.agentWorkflow` available after Task 8's `prisma generate`). Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts
git commit -m "feat(api): emit parts contract via workflow engine and PartStreamEmitter"
```

---

### Task 12: Full verification + spec self-review

- [ ] **Step 1: Run all affected tests.** `nx affected -t test` (or explicitly the libs): `bunx vitest run libs/ai/src libs/shared/src`. Expected: all green (Tasks 2,3,4,7,9,10 specs).

- [ ] **Step 2: Build everything.** `nx build ai && nx build shared && nx build web-ui`. Expected: no errors.

- [ ] **Step 3: Manual SSE smoke (optional but recommended).** With local DB + dev server (`bun run dev`), POST to `/api/v1/inference?format=sse` with a message and confirm `data:` frames now include `part_start`/`thinking_step`/`token`/`part_complete`/`done`. Configure one `AgentWorkflow` row (`isActive:true`) and confirm a menu value advances the cursor.

- [ ] **Step 4: Spec self-review** against `docs/superpowers/specs/2026-05-31-chat-widget-backend-protocol-design.md` §1–§11. Confirm each DoD item (§10):
  - [ ] Route emits the full contract via the emitter over `fullStream`.
  - [ ] Real tool calls render as a thinking timeline.
  - [ ] A configured `AgentWorkflow` drives a multi-step menu walk with persisted cursor.
  - [ ] `generate_spreadsheet`/`generate_pdf` produce `file` parts with signed URLs.
  - [ ] Parts persist on `InferenceSessionMessage.parts` and rehydrate on resume.
  - [ ] Conformance test green.
  - [ ] Emitter/engine/file-gen unit-tested; route stays thin.
  - [ ] Errors degrade gracefully (stream error, tool failure, malformed workflow → LLM fallback).

---

## Out of scope (deferred)

- **Phase 3:** Designer UI to author `AgentWorkflow.definition`, toggle thinking visibility, manage versions/`isActive`. This plan only requires the engine to READ an active workflow.
- Image-generation output (`image` part producer) — Phase 2 ships `file` parts only.
- Native model reasoning-token thinking — using real tool steps by decision.
