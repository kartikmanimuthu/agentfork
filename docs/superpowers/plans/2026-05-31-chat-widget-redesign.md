# Chat Widget Redesign — Phase 1: Widget UI Rewrite & Client Feature Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite every presentation component of the `smc-chat-widget` StencilJS Web Component on a fresh design-token system, introduce a message-parts data model as the new spine, and build three new feature surfaces (agent thinking timeline, server-driven menu workflow, file/image output) rendered against a mock transport that conforms to the exact SSE contract Phase 2 will implement. Preserve all existing plumbing (services, session resumption, file upload, CSAT, pre-chat, proactive engine).

**Architecture:** Keep-the-plumbing / rewrite-the-surface. Services (`api`, `stream`, `config`, `storage`) and the reactive `@stencil/store` are preserved and extended, never replaced. The flat `Message { content: string }` becomes `Message { parts: MessagePart[] }` — an ordered array of typed parts. A single `<smc-message-part>` dispatcher renders each part by `type`. A `MockTransport` (swapped via `?mock=1` or `mockScenario` prop) emits scripted SSE event sequences through the *same* interface as the real `StreamService`, so Phase 2 wiring is a drop-in replacement.

**Tech Stack:** StencilJS 4.x (`@Component`, `@Prop`, `@State`, `@Event`, `@Element`, shadow DOM), `@stencil/store`, `@stencil/vitest` (`render()`) + Vitest (`describe/it/expect`), CSS custom properties (design tokens), SSE async generators.

**Test command (all SDK):** `nx test sdk` (runs `vitest run` in `apps/sdk`).
**Test command (single file):** from `apps/sdk` cwd, `bunx vitest run src/components/<comp>/<comp>.spec.tsx`.
**Build command:** from `apps/sdk` cwd, `bunx stencil build`.
**Full SDK pipeline (build + copy assets to web-ui):** from repo root, `bun run sdk:build`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/sdk/src/types/index.ts` | Replace flat `Message` with parts model; add `MessagePart`, `ThinkingStep`, `MenuOption`, `CardButton`; extend `StreamEvent` |
| Create | `apps/sdk/src/styles/tokens.css` | Full design-token system (brand/surface/text/bubbles/status/geometry/motion/type), light + dark maps |
| Modify | `apps/sdk/src/store/widget-store.ts` | Adapt `addMessage`/`updateLastMessage`/`finalizeLastMessage` to parts; add `appendPart`, `appendTokenToPart`, `upsertThinkingStep`, `completePart` |
| Modify | `apps/sdk/src/store/__tests__/widget-store.spec.ts` | Update existing store tests + add new-mutation tests (existing file, do not create a duplicate) |
| Create | `apps/sdk/src/services/mock-transport.ts` | `MockTransport` matching `StreamService.parseSSE` async-generator interface |
| Create | `apps/sdk/src/services/mock-scenarios.ts` | 5 scripted scenarios (thinking→text, menu walk, text+PDF+sheet, image, mid-stream error+retry) |
| Create | `apps/sdk/src/services/mock-transport.spec.ts` | Verify each scenario emits the documented event sequence |
| Create | `apps/sdk/src/components/smc-message-part/smc-message-part.tsx` | Dispatcher: render a part by `type` |
| Create | `apps/sdk/src/components/smc-message-part/smc-message-part.css` | Dispatcher wrapper styles |
| Create | `apps/sdk/src/components/smc-message-part/smc-message-part.spec.tsx` | Dispatch-by-type tests |
| Create | `apps/sdk/src/components/smc-part-text/*` | Text part (markdown via `smc-markdown`) + spec |
| Create | `apps/sdk/src/components/smc-part-thinking/*` | Thinking timeline (collapse/expand, step dots, data cards) + spec |
| Create | `apps/sdk/src/components/smc-part-menu/*` | Server-driven menu options; emits outbound `value` + spec |
| Create | `apps/sdk/src/components/smc-part-file/*` | File download card (type-aware icon, size, retry) + spec |
| Create | `apps/sdk/src/components/smc-part-image/*` | Inline image, click-to-enlarge, broken-image placeholder + spec |
| Create | `apps/sdk/src/components/smc-part-card/*` | Rich card renderer (absorbs `smc-rich-card` rendering) + spec |
| Modify | `apps/sdk/src/components/smc-message/smc-message.tsx` | Render `message.parts` via dispatcher instead of flat `content` |
| Modify | `apps/sdk/src/components/smc-message/smc-message.spec.tsx` | Update to parts model |
| Modify | `apps/sdk/src/components/smc-input-bar/smc-input-bar.tsx` | Parts-aware send; outbound menu/card-button `value` sends; transport selection |
| Modify | `apps/sdk/src/components/smc-message-list/smc-message-list.tsx` | Parts-aware; entrance motion |
| Modify | `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.{tsx,css}` | Import `tokens.css`; seed brand tokens; `mockScenario` prop |
| Modify | `apps/sdk/src/components/smc-chat-window/*` | Re-style on tokens; open/scale transition |
| Modify | `apps/sdk/src/components/smc-header/*` | Re-style on tokens |
| Modify | `apps/sdk/src/components/smc-launcher/*` | Re-style on tokens |
| Modify | `apps/sdk/src/components/smc-typing-indicator/*` | Re-style on tokens; reduced-motion gate |
| Modify | `apps/sdk/src/components/smc-markdown/*` | Re-style on tokens |
| Modify | `apps/sdk/src/components/{smc-quick-replies,smc-feedback,smc-csat-survey,smc-pre-chat-form,smc-kb-suggestions,smc-proactive-engine,smc-file-preview}/*.css` | Re-style on tokens (logic unchanged) |
| Modify | `apps/sdk/src/index.html` | Sandbox scenario switcher for visual verification |

---

## Conventions for every component task

- **One folder per component:** `.tsx` + `.css` + `.spec.tsx`, `shadow: true`.
- **Spec pattern** (matches the existing `smc-message.spec.tsx` exactly — `render()` takes JSX directly, NOT a `{ components, template }` object). Component classes are imported at the top **for registration side-effect**; importing the class is what defines the custom element. Object props (like `part`) are passed as JSX attributes — `h()` sets them as element properties.

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcPartText } from './smc-part-text';
import { SmcMarkdown } from '../smc-markdown/smc-markdown'; // import any child the test asserts on

describe('SmcPartText', () => {
  it('renders markdown text', async () => {
    const { root } = await render(
      <smc-part-text part={{ type: 'text', text: 'hello' }} />
    );
    expect(root.shadowRoot!.querySelector('smc-markdown')).toBeTruthy();
  });
});
```

> **Critical:** do **not** use `render({ components, template })` — this project's `@stencil/vitest` `render()` accepts a JSX element directly and returns `{ root }`. Assert via `root.shadowRoot!.querySelector(...)`. To exercise a child component's behavior, import its class at the top of the spec so it registers.

- **No hardcoded colors/spacing/motion** in any component CSS — read tokens (`var(--smc-*)`).
- **All animation gated** behind `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }` in each component that animates.
- **Every async path** wrapped in try/catch; log via the existing logging pattern (the widget uses `console.*` today — keep that for the SDK bundle, do not introduce Pino into the browser bundle).
- **TDD:** write the spec first (red), implement (green), refactor. Run the single-file test after each component; run `nx test sdk` after each task group.

> **Build-chain note (important):** Task 1 changes the `Message`/`StreamEvent` shape, which makes `bunx stencil build` RED across **9 files** until every consumer migrates. The consumers are: `store/widget-store.ts` (Task 3), `store/__tests__/widget-store.spec.ts` (Task 3), `smc-chat-widget.tsx` (Task 7), `smc-input-bar.tsx` (Task 9), `smc-message-list.tsx` + `.spec.tsx` (Task 8), and three stray test fixtures that build old-shape `Message` literals — `smc-chat-window.spec.tsx`, `smc-header.spec.tsx`, `smc-quick-replies.spec.tsx` (migrate each in Task 8 alongside the message-rendering changes; they only need `status: 'sent'→'complete'` and `content→parts:[{type:'text',text}]`). **Therefore: intermediate tasks verify via their own isolated `bunx vitest run <file>` runs, NOT a full build. The full green `bunx stencil build` is the Task 12 gate.**

---

### Task 1: Message-parts type model

**Files:**
- Modify: `apps/sdk/src/types/index.ts`

- [ ] **Step 1: Replace the flat `Message` and extend `StreamEvent`**

Replace the `Message` interface (lines 39–46) and `StreamEvent` interface (lines 62–68) in `apps/sdk/src/types/index.ts`. Keep `FileAttachment`, `KbArticle`, `SessionInfo`, `SdkWidgetConfig`, `PreChatField`, `ProactiveRule` unchanged. Update `WidgetState.messages` to the new `Message[]`.

```typescript
export interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: 'active' | 'done';
  data?: Record<string, string>;
}

export interface MenuOption {
  label: string;
  value: string; // sent to backend on selection
  icon?: string;
}

export interface CardButton {
  label: string;
  url?: string;
  value?: string; // if present, sends as a message instead of navigating
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] }
  | { type: 'menu'; title?: string; options: MenuOption[] }
  | { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'card'; title: string; description?: string; buttons?: CardButton[] };

export type MessagePartType = MessagePart['type'];

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  status: 'sending' | 'streaming' | 'complete' | 'error';
  parts: MessagePart[];
}
```

Replace `StreamEvent` with the §6 contract (keep it a discriminated-ish flat shape so the existing parser and the mock can both produce it):

```typescript
export interface StreamEvent {
  type: 'part_start' | 'token' | 'thinking_step' | 'part_complete' | 'done' | 'error';
  messageId?: string;
  partIndex?: number;
  partType?: MessagePartType; // for part_start
  content?: string; // for token
  step?: ThinkingStep; // for thinking_step
  message?: string; // for error
  // file/image/card payloads delivered on part_start for non-streaming parts:
  part?: MessagePart;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}
```

Update `WidgetState` (the `messages: Message[]` field already references `Message`, so no change needed beyond the new `Message` shape). Remove `streaming.currentTokens` reliance is **not** required — leave `streaming: { active: boolean; currentTokens: string }` as-is for backward compat; it is no longer the source of truth but harmless.

- [ ] **Step 2: Verify it compiles**

From `apps/sdk`: `bunx stencil build` — expect type errors in `widget-store.ts`, `smc-input-bar.tsx`, `smc-chat-widget.tsx`, `smc-message.tsx` (they use the old flat shape). These are fixed in Tasks 3, 9, 7, 8. This step only confirms the type file itself is syntactically valid; the downstream errors are expected and addressed next.

---

### Task 2: Design-token system

**Files:**
- Create: `apps/sdk/src/styles/tokens.css`

- [ ] **Step 1: Create `tokens.css`** with the full token layer on `:host`, light + dark maps, brand seed slots.

```css
/* apps/sdk/src/styles/tokens.css
   Single design-token layer. Imported by the root component.
   Brand tokens (--smc-primary*) are overwritten at boot from config. */
:host {
  /* Brand */
  --smc-primary: #4f46e5;
  --smc-primary-fg: #ffffff;
  --smc-primary-hover: #4338ca;
  --smc-primary-faint: rgba(79, 70, 229, 0.08);
  --smc-primary-gradient: linear-gradient(135deg, var(--smc-primary), var(--smc-primary-hover));
  --smc-accent: #06b6d4;

  /* Surface */
  --smc-bg: #ffffff;
  --smc-surface: #f8fafc;
  --smc-surface-2: #f1f5f9;
  --smc-border: #e2e8f0;

  /* Text */
  --smc-text: #0f172a;
  --smc-text-muted: #475569;
  --smc-text-faint: #94a3b8;

  /* Bubbles */
  --smc-bubble-user: var(--smc-primary);
  --smc-bubble-user-fg: var(--smc-primary-fg);
  --smc-bubble-bot: #f1f5f9;
  --smc-bubble-bot-fg: #0f172a;

  /* Status */
  --smc-success: #16a34a;
  --smc-warn: #d97706;
  --smc-error: #dc2626;
  --smc-online: #22c55e;

  /* Geometry */
  --smc-radius-sm: 8px;
  --smc-radius-md: 14px;
  --smc-radius-lg: 20px;
  --smc-radius-full: 9999px;
  --smc-space-1: 4px;
  --smc-space-2: 8px;
  --smc-space-3: 12px;
  --smc-space-4: 16px;
  --smc-space-5: 24px;
  --smc-space-6: 32px;
  --smc-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
  --smc-shadow-md: 0 4px 16px rgba(15, 23, 42, 0.10);
  --smc-shadow-lg: 0 12px 40px rgba(15, 23, 42, 0.18);

  /* Motion */
  --smc-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --smc-dur-fast: 120ms;
  --smc-dur-base: 200ms;
  --smc-dur-slow: 320ms;

  /* Type */
  --smc-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --smc-fs-xs: 11px;
  --smc-fs-sm: 13px;
  --smc-fs-md: 14px;
  --smc-fs-lg: 16px;
  --smc-fw-normal: 400;
  --smc-fw-medium: 500;
  --smc-fw-semibold: 600;
  --smc-fw-bold: 700;
}

:host(.theme-dark) {
  --smc-bg: #0b1120;
  --smc-surface: #111827;
  --smc-surface-2: #1f2937;
  --smc-border: #1f2937;
  --smc-text: #f1f5f9;
  --smc-text-muted: #94a3b8;
  --smc-text-faint: #64748b;
  --smc-bubble-bot: #1f2937;
  --smc-bubble-bot-fg: #f1f5f9;
  --smc-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --smc-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
  --smc-shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.6);
}

@media (prefers-color-scheme: dark) {
  :host(.theme-auto) {
    --smc-bg: #0b1120;
    --smc-surface: #111827;
    --smc-surface-2: #1f2937;
    --smc-border: #1f2937;
    --smc-text: #f1f5f9;
    --smc-text-muted: #94a3b8;
    --smc-text-faint: #64748b;
    --smc-bubble-bot: #1f2937;
    --smc-bubble-bot-fg: #f1f5f9;
  }
}
```

- [ ] **Step 2: Wire the brand seed at boot** — covered in Task 7 (root component reads `config.primaryColor` → sets `--smc-primary` + derives `--smc-primary-hover`/`--smc-primary-faint`/`--smc-primary-gradient` inline, and applies `theme-light`/`theme-dark`/`theme-auto` host class).

---

### Task 3: Store mutations for parts

**Files:**
- Modify: `apps/sdk/src/store/widget-store.ts`
- Modify: `apps/sdk/src/store/__tests__/widget-store.spec.ts` (existing file — add new-mutation cases and fix old-shape `Message` literals; do NOT create a new spec elsewhere)

- [ ] **Step 1: Update the existing spec** (`apps/sdk/src/store/__tests__/widget-store.spec.ts`). First migrate any existing test that builds an old-shape `Message` (flat `content`/`timestamp`/`status:'sent'`) to the parts shape. Then append the new-mutation cases below:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  reset, addMessage, appendPart, appendTokenToPart,
  upsertThinkingStep, completePart, finalizeLastMessage, state,
} from './widget-store';
import type { Message } from '../types';

function assistantMsg(id = 'm1'): Message {
  return { id, role: 'assistant', createdAt: '2026-05-31T00:00:00Z', status: 'streaming', parts: [] };
}

describe('widget-store parts mutations', () => {
  beforeEach(() => reset());

  it('appendPart pushes a part onto the matching message', () => {
    addMessage(assistantMsg());
    appendPart('m1', { type: 'text', text: '' });
    expect(state.messages[0].parts).toHaveLength(1);
    expect(state.messages[0].parts[0].type).toBe('text');
  });

  it('appendTokenToPart concatenates into a text part', () => {
    addMessage(assistantMsg());
    appendPart('m1', { type: 'text', text: '' });
    appendTokenToPart('m1', 0, 'He');
    appendTokenToPart('m1', 0, 'llo');
    const p = state.messages[0].parts[0];
    expect(p.type === 'text' && p.text).toBe('Hello');
  });

  it('upsertThinkingStep adds then patches a step by id', () => {
    addMessage(assistantMsg());
    appendPart('m1', { type: 'thinking', status: 'active', steps: [] });
    upsertThinkingStep('m1', 0, { id: 's1', label: 'Searching', status: 'active' });
    upsertThinkingStep('m1', 0, { id: 's1', label: 'Searching', status: 'done' });
    const p = state.messages[0].parts[0];
    expect(p.type === 'thinking' && p.steps).toHaveLength(1);
    expect(p.type === 'thinking' && p.steps[0].status).toBe('done');
  });

  it('completePart marks a thinking part done', () => {
    addMessage(assistantMsg());
    appendPart('m1', { type: 'thinking', status: 'active', steps: [] });
    completePart('m1', 0);
    const p = state.messages[0].parts[0];
    expect(p.type === 'thinking' && p.status).toBe('done');
  });

  it('finalizeLastMessage sets id and complete status', () => {
    addMessage(assistantMsg('temp'));
    finalizeLastMessage('real-id');
    expect(state.messages[0].id).toBe('real-id');
    expect(state.messages[0].status).toBe('complete');
  });
});
```

Run: from `apps/sdk`, `bunx vitest run src/store/__tests__/widget-store.spec.ts` → red.

- [ ] **Step 2: Implement the mutations.** In `widget-store.ts`, replace `updateLastMessage` and `finalizeLastMessage` and add the new helpers. Keep `addMessage`/`setMessages`/all other exports.

```typescript
function patchMessage(messageId: string, fn: (m: Message) => Message) {
  const idx = state.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  const msgs = [...state.messages];
  msgs[idx] = fn(msgs[idx]);
  state.messages = msgs;
}

export function appendPart(messageId: string, part: MessagePart) {
  patchMessage(messageId, (m) => ({ ...m, status: 'streaming', parts: [...m.parts, part] }));
}

export function appendTokenToPart(messageId: string, partIndex: number, content: string) {
  patchMessage(messageId, (m) => {
    const parts = [...m.parts];
    const p = parts[partIndex];
    if (p && p.type === 'text') parts[partIndex] = { ...p, text: p.text + content };
    return { ...m, parts };
  });
}

export function upsertThinkingStep(messageId: string, partIndex: number, step: ThinkingStep) {
  patchMessage(messageId, (m) => {
    const parts = [...m.parts];
    const p = parts[partIndex];
    if (p && p.type === 'thinking') {
      const steps = [...p.steps];
      const i = steps.findIndex((s) => s.id === step.id);
      if (i === -1) steps.push(step);
      else steps[i] = { ...steps[i], ...step };
      parts[partIndex] = { ...p, steps };
    }
    return { ...m, parts };
  });
}

export function completePart(messageId: string, partIndex: number) {
  patchMessage(messageId, (m) => {
    const parts = [...m.parts];
    const p = parts[partIndex];
    if (p && p.type === 'thinking') parts[partIndex] = { ...p, status: 'done' };
    return { ...m, parts };
  });
}

export function finalizeLastMessage(messageId: string) {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant') {
    patchMessage(last.id, (m) => ({ ...m, id: messageId, status: 'complete' }));
  }
}

export function markLastMessageError(text = 'Sorry, something went wrong. Please try again.') {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant') {
    patchMessage(last.id, (m) => ({
      ...m,
      status: 'error',
      parts: m.parts.length ? m.parts : [{ type: 'text', text }],
    }));
  }
}
```

Remove the old `updateLastMessage` (token-into-flat-content) — callers move to `appendTokenToPart`. Update the import line to include `MessagePart`, `ThinkingStep`. Keep `reset` exported (the spec uses it).

Run: `bunx vitest run src/store/__tests__/widget-store.spec.ts` → green.

---

### Task 4: Mock transport + scenarios

**Files:**
- Create: `apps/sdk/src/services/mock-scenarios.ts`
- Create: `apps/sdk/src/services/mock-transport.ts`
- Create: `apps/sdk/src/services/mock-transport.spec.ts`

- [ ] **Step 1: Define scenarios** (`mock-scenarios.ts`) as arrays of `{ event: StreamEvent; delayMs: number }`. Five scenarios per §9.

```typescript
import type { StreamEvent } from '../types';

export interface ScriptedEvent {
  event: StreamEvent;
  delayMs: number;
}
export type ScenarioKey = 'thinking' | 'menu' | 'files' | 'image' | 'error';

const M = 'mock-msg';

export const SCENARIOS: Record<ScenarioKey, ScriptedEvent[]> = {
  // 1. Thinking timeline, then a text answer
  thinking: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'thinking' } },
    { delayMs: 400, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's1', label: 'Understanding the question', status: 'active' } } },
    { delayMs: 500, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's1', label: 'Understanding the question', status: 'done' } } },
    { delayMs: 200, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's2', label: 'Searching knowledge base', status: 'active', data: { hits: '4', source: 'docs' } } } },
    { delayMs: 600, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's2', label: 'Searching knowledge base', status: 'done', data: { hits: '4', source: 'docs' } } } },
    { delayMs: 200, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 100, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 1, content: 'Based on your plan, ' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 1, content: 'refunds are processed within 5 business days.' } },
    { delayMs: 100, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 2. Server-driven menu (one step; selecting sends an outbound message → next step comes from a fresh send)
  menu: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'What can I help you with today?' } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'menu', part: { type: 'menu', title: 'Choose a topic', options: [
      { label: 'Billing & refunds', value: 'topic:billing', icon: '💳' },
      { label: 'Technical support', value: 'topic:support', icon: '🛠️' },
      { label: 'Account settings', value: 'topic:account', icon: '⚙️' },
    ] } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 3. Text + PDF + spreadsheet artifacts
  files: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'Here is your report and the raw data:' } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'file', part: { type: 'file', name: 'Q2-summary.pdf', mimeType: 'application/pdf', url: 'data:application/pdf;base64,JVBERi0xLjQK', sizeBytes: 248000 } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 2, partType: 'file', part: { type: 'file', name: 'metrics.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: 'data:text/plain;base64,bW9jaw==', sizeBytes: 51200 } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 2 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 4. Image output
  image: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'Here is the chart you asked for:' } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'image', part: { type: 'image', url: 'https://placehold.co/480x280/png', alt: 'Revenue chart' } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 5. Mid-stream error + retry
  error: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'Let me look that up' } },
    { delayMs: 300, event: { type: 'error', messageId: M, message: 'Upstream timeout' } },
  ],
};
```

- [ ] **Step 2: Implement `MockTransport`** (`mock-transport.ts`) exposing `parseSSE()` as an async generator — the *same* shape `StreamService.parseSSE` returns, so `smc-input-bar` consumes either interchangeably.

```typescript
import type { StreamEvent } from '../types';
import { SCENARIOS, type ScenarioKey, type ScriptedEvent } from './mock-scenarios';

export class MockTransport {
  constructor(private scenario: ScenarioKey = 'thinking') {}

  setScenario(scenario: ScenarioKey) {
    this.scenario = scenario;
  }

  // Mirrors StreamService.parseSSE(response): AsyncGenerator<StreamEvent>
  async *parseSSE(): AsyncGenerator<StreamEvent> {
    const script: ScriptedEvent[] = SCENARIOS[this.scenario] ?? SCENARIOS.thinking;
    for (const { event, delayMs } of script) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield event;
    }
  }
}
```

- [ ] **Step 3: Spec** (`mock-transport.spec.ts`) — assert each scenario emits the documented terminal event and well-formed parts.

```typescript
import { describe, it, expect } from 'vitest';
import { MockTransport } from './mock-transport';
import type { ScenarioKey } from './mock-scenarios';
import type { StreamEvent } from '../types';

async function drain(key: ScenarioKey): Promise<StreamEvent[]> {
  const t = new MockTransport(key);
  const out: StreamEvent[] = [];
  for await (const e of t.parseSSE()) out.push(e);
  return out;
}

describe('MockTransport scenarios', () => {
  it('thinking → ends with done and contains a thinking part_start', async () => {
    const e = await drain('thinking');
    expect(e.some((x) => x.type === 'part_start' && x.partType === 'thinking')).toBe(true);
    expect(e[e.length - 1].type).toBe('done');
  });

  it('menu → carries a menu part with options', async () => {
    const e = await drain('menu');
    const menu = e.find((x) => x.partType === 'menu');
    expect(menu?.part?.type).toBe('menu');
    expect(menu?.part?.type === 'menu' && menu.part.options.length).toBeGreaterThan(0);
  });

  it('files → emits two file parts', async () => {
    const e = await drain('files');
    expect(e.filter((x) => x.partType === 'file')).toHaveLength(2);
  });

  it('image → emits an image part', async () => {
    const e = await drain('image');
    expect(e.some((x) => x.partType === 'image')).toBe(true);
  });

  it('error → terminates with an error event', async () => {
    const e = await drain('error');
    expect(e[e.length - 1].type).toBe('error');
  });
});
```

Run: `bunx vitest run src/services/mock-transport.spec.ts` → green.

---

### Task 5: `smc-message-part` dispatcher

> **Ordering correction (discovered during execution):** Stencil's lazy-load runtime calls `customElements.whenDefined(tag)` for every dash-tagged child and `render()` blocks on hydration until those children resolve. Dumb `HTMLElement` stubs register the tag but never hydrate, so the dispatcher test hangs/timeouts. The existing `smc-message.spec.tsx` avoids this by **importing the real child component classes** (`SmcMarkdown`, `SmcFeedback`) at the top. **Therefore Task 6 (leaf components) must be implemented BEFORE Task 5's spec.** The dispatcher `.tsx`/`.css` can be written anytime (trivial), but its spec must import the six real `SmcPart*` classes so hydration resolves — no stubs.

**Files:**
- Create: `apps/sdk/src/components/smc-message-part/smc-message-part.tsx`
- Create: `apps/sdk/src/components/smc-message-part/smc-message-part.css`
- Create: `apps/sdk/src/components/smc-message-part/smc-message-part.spec.tsx`

- [ ] **Step 1: Spec first** — dispatch by `type`.

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcMessagePart } from './smc-message-part';
import type { MessagePart } from '../../types';

// render() takes JSX directly; the part classes need not be imported because
// the dispatcher test only asserts the child *tag* is emitted, not its behavior.
async function mount(part: MessagePart) {
  return render(<smc-message-part part={part} />);
}

describe('smc-message-part dispatcher', () => {
  it('renders text part', async () => {
    const { root } = await mount({ type: 'text', text: 'hi' });
    expect(root.shadowRoot!.querySelector('smc-part-text')).toBeTruthy();
  });
  it('renders thinking part', async () => {
    const { root } = await mount({ type: 'thinking', status: 'active', steps: [] });
    expect(root.shadowRoot!.querySelector('smc-part-thinking')).toBeTruthy();
  });
  it('renders menu part', async () => {
    const { root } = await mount({ type: 'menu', options: [{ label: 'a', value: 'a' }] });
    expect(root.shadowRoot!.querySelector('smc-part-menu')).toBeTruthy();
  });
  it('renders file part', async () => {
    const { root } = await mount({ type: 'file', name: 'a.pdf', mimeType: 'application/pdf', url: '#' });
    expect(root.shadowRoot!.querySelector('smc-part-file')).toBeTruthy();
  });
  it('renders image part', async () => {
    const { root } = await mount({ type: 'image', url: '#' });
    expect(root.shadowRoot!.querySelector('smc-part-image')).toBeTruthy();
  });
  it('renders card part', async () => {
    const { root } = await mount({ type: 'card', title: 'T' });
    expect(root.shadowRoot!.querySelector('smc-part-card')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement the dispatcher.**

```tsx
import { Component, Prop, h } from '@stencil/core';
import type { MessagePart } from '../../types';

@Component({ tag: 'smc-message-part', styleUrl: 'smc-message-part.css', shadow: true })
export class SmcMessagePart {
  @Prop() part!: MessagePart;

  render() {
    const p = this.part;
    switch (p.type) {
      case 'text': return <smc-part-text part={p}></smc-part-text>;
      case 'thinking': return <smc-part-thinking part={p}></smc-part-thinking>;
      case 'menu': return <smc-part-menu part={p}></smc-part-menu>;
      case 'file': return <smc-part-file part={p}></smc-part-file>;
      case 'image': return <smc-part-image part={p}></smc-part-image>;
      case 'card': return <smc-part-card part={p}></smc-part-card>;
      default: return null;
    }
  }
}
```

`smc-message-part.css`: `:host { display: block; }`.

Run: `bunx vitest run src/components/smc-message-part/smc-message-part.spec.tsx` → green (children resolve as custom elements in the render harness even before their classes are registered; the dispatcher test only asserts the tag is emitted).

---

### Task 6: Part components (one sub-task each)

Each part component: spec first, then implement, then run its single-file test. All read tokens; no hardcoded values.

- [ ] **Step 6a — `smc-part-text`**

Spec asserts it renders `<smc-markdown>` with the text. Implementation:

```tsx
import { Component, Prop, h } from '@stencil/core';

@Component({ tag: 'smc-part-text', styleUrl: 'smc-part-text.css', shadow: true })
export class SmcPartText {
  @Prop() part!: { type: 'text'; text: string };
  render() {
    return <smc-markdown content={this.part.text}></smc-markdown>;
  }
}
```

CSS: `:host { display: block; color: inherit; font: var(--smc-fw-normal) var(--smc-fs-md)/1.5 var(--smc-font); }`.

- [ ] **Step 6b — `smc-part-thinking`** (headline feature)

Spec cases: (1) renders one row per step; (2) active part is expanded, done part collapsed by default; (3) clicking the header toggles expansion; (4) active step has a `.dot.active`, done step has `.dot.done`; (5) renders `step.data` key/value cards when present.

```tsx
import { Component, Prop, State, h } from '@stencil/core';
import type { ThinkingStep } from '../../types';

@Component({ tag: 'smc-part-thinking', styleUrl: 'smc-part-thinking.css', shadow: true })
export class SmcPartThinking {
  @Prop() part!: { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] };
  @State() manualExpanded: boolean | null = null;

  private get expanded(): boolean {
    if (this.manualExpanded !== null) return this.manualExpanded;
    return this.part.status === 'active'; // expanded while thinking, collapsed when done
  }

  private toggle = () => { this.manualExpanded = !this.expanded; };

  render() {
    const { status, steps } = this.part;
    const label = status === 'active' ? 'Thinking…' : `Thought for ${steps.length} step${steps.length === 1 ? '' : 's'}`;
    return (
      <div class={`thinking ${status}`}>
        <button class="head" onClick={this.toggle} aria-expanded={String(this.expanded)}>
          <span class="spark" aria-hidden="true">✦</span>
          <span class="title">{label}</span>
          <span class={`chev ${this.expanded ? 'open' : ''}`} aria-hidden="true">⌄</span>
        </button>
        {this.expanded ? (
          <ol class="steps">
            {steps.map((s) => (
              <li class="step" key={s.id}>
                <span class={`dot ${s.status}`} aria-hidden="true"></span>
                <div class="body">
                  <span class="label">{s.label}</span>
                  {s.detail ? <span class="detail">{s.detail}</span> : null}
                  {s.data ? (
                    <div class="data">
                      {Object.entries(s.data).map(([k, v]) => (
                        <div class="kv" key={k}><span class="k">{k}</span><span class="v">{v}</span></div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }
}
```

CSS: bordered card (`var(--smc-border)`, `var(--smc-radius-md)`, `var(--smc-surface)`), `.dot.done` green `var(--smc-success)`, `.dot.active` pulsing `var(--smc-primary)` via keyframes gated by reduced-motion, steps fade+slide-in. Include the reduced-motion block.

- [ ] **Step 6c — `smc-part-menu`**

Spec cases: (1) renders one button per option with its label; (2) clicking an option emits a `menuSelect` `CustomEvent` whose `detail` is the option's `value`; (3) after a selection the chosen option gets a `.chosen` class.

```tsx
import { Component, Prop, State, Event, EventEmitter, h } from '@stencil/core';
import type { MenuOption } from '../../types';

@Component({ tag: 'smc-part-menu', styleUrl: 'smc-part-menu.css', shadow: true })
export class SmcPartMenu {
  @Prop() part!: { type: 'menu'; title?: string; options: MenuOption[] };
  @State() chosen: string | null = null;
  @Event() menuSelect!: EventEmitter<string>;

  private select(opt: MenuOption) {
    if (this.chosen) return; // one selection per menu
    this.chosen = opt.value;
    this.menuSelect.emit(opt.value);
  }

  render() {
    return (
      <div class="menu">
        {this.part.title ? <div class="menu-title">{this.part.title}</div> : null}
        <div class="options">
          {this.part.options.map((o, i) => (
            <button
              class={`option ${this.chosen === o.value ? 'chosen' : ''} ${this.chosen && this.chosen !== o.value ? 'dimmed' : ''}`}
              style={{ '--i': String(i) }}
              disabled={!!this.chosen}
              onClick={() => this.select(o)}
              key={o.value}
            >
              {o.icon ? <span class="icon" aria-hidden="true">{o.icon}</span> : null}
              <span class="label">{o.label}</span>
              <span class="arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
}
```

CSS: stacked cards, stagger via `transition-delay: calc(var(--i) * 30ms)`, hover nudges right (`transform: translateX(2px)`), `.chosen` border `var(--smc-primary)`, `.dimmed` opacity 0.5. The parent (`smc-message-list`/`smc-input-bar`) listens for `menuSelect` and sends the value outbound — wired in Task 9.

- [ ] **Step 6d — `smc-part-file`**

Spec cases: (1) renders the file name and formatted size; (2) PDF mimeType → `.icon.pdf`, spreadsheet → `.icon.sheet`, else `.icon.generic`; (3) download button has `href={url}` + `download` attr; (4) if `imgError`/load fails an error state with a retry button appears (simulate by toggling internal `failed` state).

```tsx
import { Component, Prop, State, h } from '@stencil/core';

const KB = 1024;
function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}
function kind(mimeType: string): 'pdf' | 'sheet' | 'generic' {
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'sheet';
  return 'generic';
}

@Component({ tag: 'smc-part-file', styleUrl: 'smc-part-file.css', shadow: true })
export class SmcPartFile {
  @Prop() part!: { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number };
  @State() failed = false;

  private onError = () => { this.failed = true; };
  private retry = () => { this.failed = false; };

  render() {
    const k = kind(this.part.mimeType);
    if (this.failed) {
      return (
        <div class="file error">
          <span class="msg">Couldn't load this file.</span>
          <button class="retry" onClick={this.retry}>Retry</button>
        </div>
      );
    }
    return (
      <div class="file">
        <span class={`icon ${k}`} aria-hidden="true"></span>
        <div class="meta">
          <span class="name">{this.part.name}</span>
          {this.part.sizeBytes ? <span class="size">{fmtSize(this.part.sizeBytes)}</span> : null}
        </div>
        <a class="download" href={this.part.url} download={this.part.name} onError={this.onError} aria-label={`Download ${this.part.name}`}>↓</a>
      </div>
    );
  }
}
```

CSS: row card, type-aware icon colors (pdf `var(--smc-error)`, sheet `var(--smc-success)`, generic `var(--smc-text-muted)`), download button uses brand. Note: the widget never *generates* files — backend hosts them (spec §7.3 decision).

- [ ] **Step 6e — `smc-part-image`**

Spec cases: (1) renders `<img>` with `src`/`alt`; (2) `onError` swaps to a `.placeholder`; (3) clicking toggles `.enlarged`.

```tsx
import { Component, Prop, State, h } from '@stencil/core';

@Component({ tag: 'smc-part-image', styleUrl: 'smc-part-image.css', shadow: true })
export class SmcPartImage {
  @Prop() part!: { type: 'image'; url: string; alt?: string };
  @State() broken = false;
  @State() enlarged = false;

  render() {
    if (this.broken) return <div class="placeholder" aria-label="Image failed to load">🖼️</div>;
    return (
      <img
        class={`img ${this.enlarged ? 'enlarged' : ''}`}
        src={this.part.url}
        alt={this.part.alt ?? 'Image'}
        loading="lazy"
        onError={() => (this.broken = true)}
        onClick={() => (this.enlarged = !this.enlarged)}
      />
    );
  }
}
```

CSS: rounded thumbnail (`var(--smc-radius-md)`), `.enlarged` scales to full bubble width with a transition.

- [ ] **Step 6f — `smc-part-card`** (absorbs `smc-rich-card` rendering)

Spec cases: (1) renders title + optional description; (2) renders one button per `buttons[]`; (3) a button with `url` renders `<a href>`, a button with only `value` renders a `<button>` that emits `cardAction` with the value.

```tsx
import { Component, Prop, Event, EventEmitter, h } from '@stencil/core';
import type { CardButton } from '../../types';

@Component({ tag: 'smc-part-card', styleUrl: 'smc-part-card.css', shadow: true })
export class SmcPartCard {
  @Prop() part!: { type: 'card'; title: string; description?: string; buttons?: CardButton[] };
  @Event() cardAction!: EventEmitter<string>;

  render() {
    return (
      <div class="card">
        <div class="title">{this.part.title}</div>
        {this.part.description ? <div class="desc">{this.part.description}</div> : null}
        {this.part.buttons?.length ? (
          <div class="actions">
            {this.part.buttons.map((b, i) =>
              b.url ? (
                <a class="btn" href={b.url} target="_blank" rel="noopener noreferrer" key={i}>{b.label}</a>
              ) : (
                <button class="btn" onClick={() => b.value && this.cardAction.emit(b.value)} key={i}>{b.label}</button>
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  }
}
```

CSS: surface card with border + shadow-sm, brand buttons. Once verified, delete the old `smc-rich-card` component folder and remove any references (the spec mandates one card component).

Run after 6a–6f: `nx test sdk` → all part specs green.

---

### Task 7: Root component — tokens, theming, mock prop

**Files:**
- Modify: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.tsx`
- Modify: `apps/sdk/src/components/smc-chat-widget/smc-chat-widget.css`

- [ ] **Step 1: Import tokens and apply theme + brand at boot.** In `smc-chat-widget.css`, add `@import '../../styles/tokens.css';` at the top (Stencil inlines it). In the root `.tsx`, add a `mockScenario` prop and compute host class + brand vars:

```tsx
@Prop() mockScenario?: string; // when set, widget uses MockTransport with this scenario

// in render(), replace the cssVars block:
const theme = config.theme ?? 'auto';
const cssVars = {
  '--smc-primary': config.primaryColor,
  '--smc-primary-hover': config.primaryColor, // darkened at runtime via color-mix where supported
  '--smc-primary-faint': `color-mix(in srgb, ${config.primaryColor} 8%, transparent)`,
  '--smc-primary-gradient': `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`,
  '--smc-accent': config.secondaryColor,
};
return (
  <div class={`smc-root position-${config.position} theme-${theme}`} style={cssVars}>
    {/* unchanged children */}
  </div>
);
```

Apply `theme-light|dark|auto` on `:host` instead of the inner `.smc-root` if tokens are on `:host` — set it via `@Element() host` in `componentWillLoad`: `this.host.classList.add('theme-' + theme)`. (Tokens.css targets `:host(.theme-dark)`.)

- [ ] **Step 2: Update session-resume mapping to parts.** In `componentWillLoad`, the resumed-message map (lines 66–72) currently builds flat messages. Change to:

```tsx
const messages: Message[] = session.messages.map((m) => ({
  id: m.id,
  role: m.role as 'user' | 'assistant',
  createdAt: m.createdAt,
  status: 'complete',
  parts: [{ type: 'text', text: m.content }],
}));
```

- [ ] **Step 3: Build** — `bunx stencil build` succeeds (root no longer references the old flat `Message`).

---

### Task 8: `smc-message` + `smc-message-list` on parts

**Files:**
- Modify: `apps/sdk/src/components/smc-message/smc-message.tsx`
- Modify: `apps/sdk/src/components/smc-message/smc-message.spec.tsx`
- Modify: `apps/sdk/src/components/smc-message-list/smc-message-list.tsx`

- [ ] **Step 1: Rewrite `smc-message` to map parts through the dispatcher.** User messages stay simple (a single text bubble); assistant messages render each part via `<smc-message-part>`. Keep the conditional `<smc-feedback>` for completed assistant messages.

```tsx
import { Component, Prop, h } from '@stencil/core';
import type { Message } from '../../types';

@Component({ tag: 'smc-message', styleUrl: 'smc-message.css', shadow: true })
export class SmcMessage {
  @Prop() message!: Message;
  @Prop() showFeedback = false;

  render() {
    const m = this.message;
    const isUser = m.role === 'user';
    return (
      <div class={`row ${isUser ? 'user' : 'bot'} status-${m.status}`}>
        <div class="bubble">
          {m.parts.map((part, i) => (
            <smc-message-part part={part} key={i}></smc-message-part>
          ))}
          {m.status === 'error' ? <button class="retry">Retry</button> : null}
        </div>
        {!isUser && m.status === 'complete' && this.showFeedback ? (
          <smc-feedback messageId={m.id}></smc-feedback>
        ) : null}
      </div>
    );
  }
}
```

Update `smc-message.spec.tsx` to construct a parts-model `Message` and assert `smc-message-part` children render (one per part) and user vs bot row class.

- [ ] **Step 2: Update `smc-message-list`** to pass the parts `Message` to `smc-message`, keep the welcome message (render as a synthetic assistant text part), keep the 5-minute timestamp logic and typing indicator (`state.streaming.active` AND the last assistant message has no rendered token yet). Add entrance motion: `.row` fades + slides up 8px over `var(--smc-dur-base)`, gated by reduced-motion.

Run: `nx test sdk` → message + list specs green.

---

### Task 9: Input bar — parts-aware send, transport selection, outbound menu/card sends

**Files:**
- Modify: `apps/sdk/src/components/smc-input-bar/smc-input-bar.tsx`

- [ ] **Step 1: Replace the send pipeline** to build parts and consume either transport. Add a `sendValue(content)` method used by both the textarea and outbound menu/card selections. Select transport: if the root `mockScenario` prop is set (or `?mock=1` in the URL), use `MockTransport`; else the real `ApiService` + `StreamService`.

```tsx
import { MockTransport } from '../../services/mock-transport';
import type { ScenarioKey } from '../../services/mock-scenarios';
import { addMessage, appendPart, appendTokenToPart, upsertThinkingStep, completePart, finalizeLastMessage, markLastMessageError, setStreaming } from '../../store/widget-store';

private resolveMockScenario(): ScenarioKey | null {
  const widgetEl = document.querySelector('smc-chat-widget') as any;
  const fromProp = widgetEl?.mockScenario as string | undefined;
  const fromUrl = new URLSearchParams(location.search).get('mock');
  const key = (fromProp || (fromUrl ? 'thinking' : null)) as ScenarioKey | null;
  return key;
}

private async sendValue(content: string) {
  if (!content || this.sending) return;
  this.sending = true;
  const now = new Date().toISOString();

  // (session auto-create block unchanged — only runs in the real-transport path)
  const mock = this.resolveMockScenario();
  if (!mock && !state.apiKey) { this.sending = false; return; }
  if (!mock && !state.session) { /* existing auto-create-session try/catch */ }

  addMessage({ id: `u_${Date.now()}`, role: 'user', createdAt: now, status: 'complete', parts: [{ type: 'text', text: content }] });
  const assistantId = `a_${Date.now()}`;
  addMessage({ id: assistantId, role: 'assistant', createdAt: now, status: 'streaming', parts: [] });
  setStreaming(true);

  try {
    const iterator = mock
      ? new MockTransport(mock).parseSSE()
      : new StreamService().parseSSE(await new ApiService(state.baseUrl, state.apiKey!).sendMessage(state.session!.id, content));

    for await (const ev of iterator) {
      const id = assistantId; // mock uses 'mock-msg' internally; we map all events to our placeholder
      if (ev.type === 'part_start') {
        const seed =
          ev.part ??
          (ev.partType === 'text' ? { type: 'text', text: '' }
            : ev.partType === 'thinking' ? { type: 'thinking', status: 'active', steps: [] }
            : null);
        if (seed) appendPart(id, seed as any);
      } else if (ev.type === 'token' && ev.partIndex != null && ev.content) {
        appendTokenToPart(id, ev.partIndex, ev.content);
      } else if (ev.type === 'thinking_step' && ev.partIndex != null && ev.step) {
        upsertThinkingStep(id, ev.partIndex, ev.step);
      } else if (ev.type === 'part_complete' && ev.partIndex != null) {
        completePart(id, ev.partIndex);
      } else if (ev.type === 'done') {
        finalizeLastMessage(ev.messageId ?? `msg_${Date.now()}`);
      } else if (ev.type === 'error') {
        markLastMessageError(ev.message);
      }
    }
  } catch (err) {
    console.error('[smc-widget] stream failed', err);
    markLastMessageError('Connection error. Please try again.');
  } finally {
    setStreaming(false);
    this.sending = false;
  }
}

private send() {
  const content = this.text.trim();
  if (!content) return;
  this.text = '';
  setKbSuggestions([]);
  if (this.textareaEl) this.textareaEl.style.height = 'auto';
  void this.sendValue(content);
}
```

- [ ] **Step 2: Wire outbound menu/card selections.** The list renders parts that emit `menuSelect` / `cardAction`. Add a document-level (or chat-window-level) listener that calls `sendValue(detail)`. Simplest: in `smc-chat-window`, listen for `menuSelect`/`cardAction` bubbling from the message list and forward to the input bar via a shared store action, OR expose `sendValue` by having `smc-message-list` emit a `widgetSend` event the input bar listens for on `window`. Implement the `window` CustomEvent bridge:
  - In `smc-part-menu`/`smc-part-card`, after emitting their typed event, the **list** (`smc-message-list`) catches it (`onMenuSelect`, `onCardAction`) and re-dispatches `window.dispatchEvent(new CustomEvent('smc:send', { detail: value }))`.
  - In `smc-input-bar.connectedCallback`, `window.addEventListener('smc:send', (e) => this.sendValue(e.detail))`; remove in `disconnectedCallback`.

This keeps the server-driven model: a menu pick sends the option's `value` as a normal user message; the server (mock in Phase 1) streams the next step.

- [ ] **Step 3: Build + run** — `bunx stencil build`, then `nx test sdk`. Manually unsupported here; covered by the sandbox in Task 11.

---

### Task 10: Re-style ported components + reduced-motion + remaining rewrites

**Files (CSS only unless noted):**
- Modify: `smc-chat-window`, `smc-header`, `smc-launcher`, `smc-typing-indicator`, `smc-markdown`, `smc-quick-replies`, `smc-feedback`, `smc-csat-survey`, `smc-pre-chat-form`, `smc-kb-suggestions`, `smc-proactive-engine`, `smc-file-preview`

- [ ] **Step 1: Replace every hardcoded color/space/radius/shadow/font** in these components' CSS with `var(--smc-*)` tokens. No logic changes to their `.tsx`.
- [ ] **Step 2: Window open transition** — `smc-chat-window` scales/fades in from the launcher corner over `var(--smc-dur-slow) var(--smc-ease)`.
- [ ] **Step 3: Typing indicator** — three-dot bounce using tokens; shown only before the first assistant token.
- [ ] **Step 4: Global reduced-motion** — add to `tokens.css`:

```css
@media (prefers-reduced-motion: reduce) {
  :host * { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 5: Build** — `bunx stencil build` clean.

---

### Task 11: Sandbox scenario verification

**Files:**
- Modify: `apps/sdk/src/index.html`

- [ ] **Step 1: Add a scenario switcher** to the Stencil dev `index.html` that mounts `<smc-chat-widget mock-config='{...}' mock-scenario="thinking">` and offers buttons to swap `mockScenario` across `thinking | menu | files | image | error`. Provide a minimal `mock-config` JSON with `apiKeyPrefix`, `primaryColor`, `secondaryColor`, `position`, `theme`, `botName`, `welcomeMessage`.

- [ ] **Step 2: Run the dev server** — from `apps/sdk`: `bunx stencil build --dev --watch --serve --port 3007`. Open `http://localhost:3007`. Verify each scenario:
  - **thinking:** timeline expands live, steps animate, collapses to "Thought for N steps" on done, expands on click.
  - **menu:** options stagger-in; selecting sends the `value`, dims the others, next turn streams.
  - **files:** PDF (red) + spreadsheet (green) cards, sizes formatted, download works.
  - **image:** thumbnail renders, click enlarges, broken URL → placeholder.
  - **error:** partial text preserved, message marked error, Retry shown.
  - Toggle `theme` light/dark and change `primaryColor` — entire widget re-themes.
  - Enable OS "reduce motion" — animations are instant.

- [ ] **Step 3: Full pipeline** — from repo root: `bun run sdk:build` (builds + copies assets to `apps/web-ui/public/sdk-assets/`). Confirm no errors and assets land.

---

### Task 12: Final verification + spec self-review

- [ ] **Step 1:** `nx test sdk` — all specs green (store, mock, dispatcher, 6 parts, message, list).
- [ ] **Step 2:** `bunx stencil build` from `apps/sdk` — clean, no type errors, old `smc-rich-card` removed with no dangling references.
- [ ] **Step 3: Self-review against the spec** (`docs/superpowers/specs/2026-05-31-chat-widget-redesign-design.md`) §1–§13. Confirm each Definition-of-Done item (§13) is met:
  - [ ] All listed components rewritten/ported on tokens.
  - [ ] Message-parts model is the live spine; all six part types render via the dispatcher.
  - [ ] Thinking timeline, menu workflow, file download cards work end-to-end on the mock.
  - [ ] Light/dark + brand theming at runtime.
  - [ ] All five scenarios run in the sandbox and pass scenario tests.
  - [ ] Reduced-motion and part-level error states verified.
  - [ ] SSE contract (§6) and `MessagePart` types (§5) are the documented interface (types in `types/index.ts`, scenarios encode the contract).

---

## Out of scope (deferred to later phases)

- **Phase 2:** Backend emits real `part_start`/`token`/`thinking_step`/`part_complete`/`done`/`error` events; drop in the real transport and remove the mock flag.
- **Phase 3:** Designer UI to author menus/workflows, toggle thinking visibility, persist per-widget config.
