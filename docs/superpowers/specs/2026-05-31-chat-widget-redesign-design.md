# Chat Widget Redesign — Phase 1: Widget UI Rewrite & Client Feature Architecture

**Date:** 2026-05-31
**Status:** Approved design, ready for implementation planning
**Scope:** Phase 1 of 3 (widget only; backend and designer are later phases)

---

## 1. Background & Motivation

The current `smc-chat-widget` (StencilJS Web Component, `apps/sdk/`) is functionally capable but visually dated and architecturally too flat to support the experiences competitors ship. Reference products (e.g. Robylon, Intercom) demonstrate three capabilities the current widget cannot represent cleanly:

1. **Agent thinking visualization** — showing labeled reasoning/processing steps live, to keep users engaged during long-running tasks.
2. **Menu-based chatting** — routing through sample menus one step after another, like a guided workflow.
3. **Multimedia output** — downloadable artifacts (PDF, spreadsheet) and inline media generated from API responses.

The widget is also described as "multimodal": it handles rich media **in and out** (image uploads, inline images, file downloads). This is distinct from multi-model — there is **no end-user model selector** in scope.

### Why this is Phase 1 of a phased effort

The full vision is full-stack: widget UI + backend rich-message protocol + designer configuration UI. These three subsystems build and deploy independently, so cramming them into one spec would produce an unwieldy, hard-to-review plan. The effort is decomposed into three spec → plan → build cycles:

- **Phase 1 (this spec):** Complete widget UI rewrite + client-side architecture for all three new features, rendered against **mock data**. Defines the data contracts the backend must satisfy. Fully demoable on its own.
- **Phase 2 (later spec):** Extend the inference SSE/API to emit thinking steps, menu payloads, and file artifacts. Wire the widget's rendering surfaces (built in Phase 1) to real data.
- **Phase 3 (later spec):** Add designer UI to author menus/workflows, toggle thinking visibility, and persist per-widget config.

Phase 1 is highest-leverage because every architectural decision here — especially the message-parts contract — constrains the other two phases.

---

## 2. Goals & Non-Goals

### Goals

- Rewrite every **presentation** component and all CSS on a fresh design-token system in the "Modern AI / sleek" visual language.
- Introduce a **message-parts model** as the new data spine, capable of representing text, thinking timelines, menus, files, images, and cards in a single ordered message.
- Build the three new feature surfaces (thinking timeline, server-driven menu workflow, file download cards) as first-class rendered parts.
- Re-render all existing features (quick replies, CSAT, pre-chat form, proactive engine, feedback, KB suggestions, rich card, file preview) in the new design without rebuilding their logic.
- Ship a **mock transport** that conforms to the exact SSE contract Phase 2 will implement, so Phase 1 is demoable and testable end-to-end.
- Define the SSE event contract and `MessagePart` types as the authoritative interface for Phases 2 and 3.

### Non-Goals (explicitly out of scope for Phase 1)

- Real backend emission of parts (thinking steps, menus, files) — **Phase 2**.
- Designer authoring UI for menus/workflows or thinking-visibility toggles — **Phase 3**.
- End-user model-selector UI — **not being built**; the widget is multimodal, not multi-model.
- Rewriting the service/store layer — it is preserved (see §3).

---

## 3. Approach: Keep the Plumbing, Rewrite the Surface

The existing widget has a split character: the plumbing is solid, the presentation is dated, and the data model is too flat.

**Preserved as-is (proven, feature-rich):**
- `api.service.ts` — HTTP client and endpoints
- `stream.service.ts` — SSE parser
- `config.service.ts` — config fetch
- `storage.service.ts` — visitor/session persistence
- `widget-store.ts` — reactive Stencil store (extended, not replaced — see §5)
- Session resumption, visitor ID, pre-chat completion tracking

**Rewritten from the ground up (new design + token system):**
- `smc-chat-widget`, `smc-chat-window`, `smc-header`, `smc-launcher`, `smc-message-list`, `smc-message`, `smc-input-bar`, `smc-typing-indicator`, `smc-markdown`

**Ported (re-rendered in the new design, logic kept):**
- `smc-quick-replies`, `smc-feedback`, `smc-csat-survey`, `smc-pre-chat-form`, `smc-kb-suggestions`, `smc-proactive-engine`
- `smc-file-preview` — note: this is the **upload** preview shown in the input bar (outbound files the user attaches). It is distinct from `smc-part-file` (§7.3), which is the **download** card for backend-generated artifacts (inbound).
- `smc-rich-card` — its rendering logic is absorbed into the new `smc-part-card` (see below); there is **one** card component, not two.

**New components:**
- `smc-message-part` (dispatcher), `smc-part-text`, `smc-part-thinking`, `smc-part-menu`, `smc-part-file`, `smc-part-image`
- `smc-part-card` — the `card` part renderer; reuses the ported `smc-rich-card` rendering rather than duplicating it.

This maximizes reuse of what works, gives a clean foundation for what's new, and makes the parts array the exact contract Phase 2's backend must satisfy.

---

## 4. Design Token System

Every visual value lives in one CSS custom-property layer on the root `:host`, seeded from the widget config at boot. Components never hardcode colors, spacing, or motion — they read tokens. This makes theming consistent and enables runtime theme switching (fixing the current limitation where colors are frozen at boot).

```
Brand     --smc-primary, --smc-primary-fg, --smc-primary-gradient, --smc-accent
Surface   --smc-bg, --smc-surface, --smc-surface-2, --smc-border
Text      --smc-text, --smc-text-muted, --smc-text-faint
Bubbles   --smc-bubble-user, --smc-bubble-user-fg, --smc-bubble-bot, --smc-bubble-bot-fg
Status    --smc-success, --smc-warn, --smc-error, --smc-online
Geometry  --smc-radius-sm/md/lg/full, --smc-space-1..6, --smc-shadow-sm/md/lg
Motion    --smc-ease, --smc-dur-fast/base/slow
Type      --smc-font, --smc-fs-xs..lg, --smc-fw-normal/medium/semibold/bold
```

- **Light/dark** are two token maps. `theme: 'auto'` follows `prefers-color-scheme`. Theme is switchable at runtime.
- **Brand color** from config fills `--smc-primary`; derived shades (hover, gradient, faint background) are computed once at boot so a single configured color themes the entire widget.
- Tokens live in a single `tokens.css` imported by the root component.

---

## 5. Message-Parts Model (the spine)

### Current model
```ts
Message { role, content: string }
```
This cannot represent "text, then a thinking timeline, then a downloadable PDF."

### New model
```ts
interface Message {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  status: 'sending' | 'streaming' | 'complete' | 'error';
  parts: MessagePart[];          // ordered; renders top → bottom
}

type MessagePart =
  | { type: 'text';     text: string }                                  // markdown
  | { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] }
  | { type: 'menu';     title?: string; options: MenuOption[] }
  | { type: 'file';     name: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'image';    url: string; alt?: string }
  | { type: 'card';     title: string; description?: string; buttons?: CardButton[] };

interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: 'active' | 'done';
  data?: Record<string, string>;   // optional key→value data cards
}

interface MenuOption {
  label: string;
  value: string;        // sent to backend on selection
  icon?: string;
}

interface CardButton {
  label: string;
  url?: string;
  value?: string;       // if present, sends as a message instead of navigating
}
```

### Store changes
`widget-store.ts` keeps its existing shape but `messages: Message[]` adopts the new `Message` type. Mutation helpers are extended:
- `appendPart(messageId, part)`
- `appendTokenToPart(messageId, partIndex, content)`
- `upsertThinkingStep(messageId, partIndex, step)`
- `completePart(messageId, partIndex)`
- Existing `addMessage` / `updateLastMessage` are adapted to the parts shape.

### Rendering pipeline
A single `<smc-message-part>` dispatcher renders each part by `type`. Adding a future part type = one new branch + one new `smc-part-*` component; nothing else changes.

---

## 6. SSE Event Contract (defined here, implemented in Phase 2)

This is the authoritative streaming contract. Phase 1 mocks it; Phase 2 implements it on the backend.

```
event: part_start      { messageId, partIndex, type }       → append empty part of `type`
event: token           { messageId, partIndex, content }    → append text to a text part
event: thinking_step   { messageId, partIndex, step }        → push or patch a ThinkingStep
event: part_complete   { messageId, partIndex }              → mark part status done
event: done            { messageId }                          → mark message complete
event: error           { messageId?, message }                → mark message/part error
```

Menu selection and card-button `value` clicks are **outbound**: they send a normal user message whose content is the option's `value`, then the server streams the next step. This is the "server-driven menu" model.

---

## 7. Feature Surfaces

### 7.1 Thinking timeline (`smc-part-thinking`)
- Renders as a bordered card with a header: spark icon + "Thought for Ns" + chevron.
- **Collapsed by default** once `status: done`; one tap expands. While `status: active`, it is expanded and streams steps in live.
- Each step: status dot (done = green check, active = pulsing blue dot), bold label, muted detail, optional 2-column data cards from `step.data`.
- Steps animate in one-by-one as `thinking_step` events arrive.

### 7.2 Menu workflow (`smc-part-menu`)
- Optional title, then stacked option cards (icon chip + label + arrow affordance).
- Options stagger-in (~30ms apart); hover nudges right and highlights border.
- On select: emits an outbound message with `option.value`; the chosen option highlights; the next step arrives from the server and slides in.
- A breadcrumb trail ("Topic › Billing & refunds") shows the path taken.

### 7.3 File download cards (`smc-part-file`)
- Type-aware icon (PDF = red doc, spreadsheet = green chart, generic fallback), file name, formatted size, download button.
- Click downloads from `url`. The widget never generates files (backend generates + hosts, per decision).
- Error state if the URL fails to load → "couldn't load, retry."

### 7.4 Image output (`smc-part-image`)
- Inline thumbnail bubble; click to enlarge. Broken image → placeholder.

---

## 8. Motion & States

Animation is core to the "sleek" feel but must be cheap and respectful.

- **Entrance:** new messages fade + slide up (8px, 200ms). Launcher → window opens with a scale transition originating from the launcher corner.
- **Streaming:** text parts show a soft caret; thinking steps animate in as events arrive; active step has a pulsing dot.
- **Typing indicator:** three-dot bounce, shown only before the first token of an assistant turn.
- **Menu:** options stagger-in; on select, chosen highlights then next step slides in.
- **Performance:** transform/opacity only (no layout thrash). Durations from `--smc-dur-*` tokens.
- **Accessibility:** all motion gated behind `prefers-reduced-motion` → instant, no animation.

---

## 9. Mock Data Harness

Because the backend won't emit parts until Phase 2, Phase 1 ships a mock transport conforming to the exact SSE contract from §6.

- `MockTransport` implements the same interface as the real SSE service, swapped via a flag (`?mock=1` or a config field). The real path is never modified.
- A library of **scripted scenarios** emits realistic event sequences with timed delays:
  1. Thinking-then-text answer
  2. Server-driven menu walk (multi-step)
  3. Text + PDF + spreadsheet answer
  4. Image-output answer
  5. Mid-stream error + retry
- Because mock and real share one interface, Phase 2 wiring = drop in the real transport and remove the flag.
- The harness also drives the designer/sandbox preview and is the backbone of scenario tests.

---

## 10. Error Handling & Resilience

The current code swallows failures silently. New baseline:

- Every part type has an **error state** (file URL fails → retry affordance; image broken → placeholder).
- Stream interrupted mid-message → message marked `error` with an inline **Retry**; partial parts preserved.
- Send failures surface a non-blocking toast, not a dead UI.
- All async paths wrapped in try/catch; errors logged through the existing logger pattern, never console-only.

---

## 11. Component Structure & Testing

### Structure
- One folder per component (`.tsx` + `.css` + `.spec.tsx`).
- Parts under `components/parts/`: `smc-part-text`, `-thinking`, `-menu`, `-file`, `-image`, `-card`, behind the `smc-message-part` dispatcher.
- Tokens in a single `tokens.css` imported by the root.

### Testing
- Stencil/Jest spec per component: render correctness, part dispatch by type, thinking collapse/expand, menu-select emits the correct outbound `value`, reduced-motion behavior, file/image error states.
- Scenario tests drive the `MockTransport` end-to-end through the rendering pipeline (one per §9 scenario).
- Visual sanity via the existing sandbox page.

---

## 12. Build & Delivery

- Build via existing `bunx stencil build`; output continues to land in `apps/sdk/dist/` and copy to `apps/web-ui/public/sdk-assets/` via `bun run sdk:build`.
- No change to the Nx target wiring or the asset-copy step.
- The designer/sandbox preview pages render the widget via the mock transport so the redesign is reviewable without backend changes.

---

## 13. Definition of Done (Phase 1)

- All listed components rewritten/ported in the Modern AI / sleek language on the token system.
- Message-parts model is the live data spine; all six part types render via the dispatcher.
- Thinking timeline, server-driven menu workflow, and file download cards work end-to-end against the mock transport.
- Light/dark + brand-color theming works at runtime.
- All five mock scenarios run in the sandbox and pass their scenario tests.
- Reduced-motion and part-level error states verified.
- SSE event contract (§6) and `MessagePart` types (§5) documented as the interface for Phase 2/3.
