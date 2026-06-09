# Chat Widget Redesign — Phase 2: Backend Rich-Message Protocol

**Date:** 2026-05-31
**Status:** Approved design, ready for implementation planning
**Scope:** Phase 2 of 3 (backend only; widget rendering is Phase 1 — done; designer authoring is Phase 3)

---

## 1. Background & Motivation

Phase 1 rewrote the embeddable chat widget (`apps/sdk`) onto a **message-parts** data model and a **mock streaming transport**. The widget now renders six part types (text, thinking, menu, file, image, card) from an ordered `parts: MessagePart[]` array, driven by a defined SSE event contract. But every rich part is currently produced by `MockTransport` — the real backend still streams only plain text.

Phase 2 makes the **real inference backend emit that contract**, so the three headline capabilities work against live data:

1. **Agent thinking visualization** — sourced from the agent's real tool/agent steps (decided: not native reasoning tokens, not synthesized milestones).
2. **Menu-based workflows** — server-driven, backed by a per-agent **config-driven workflow tree** (decided: not LLM-improvised menus).
3. **Multimedia output** — downloadable artifacts via **dynamic generation tools** (`generate_spreadsheet`, `generate_pdf`) plus optional **static files** attached to workflow nodes (decided: both, not static-only).

### The contract is already fixed (Phase 1 is the authority)

The SSE event contract and `MessagePart` types are defined in Phase 1 and must not change. Phase 2 *implements producers* for them. The Phase 1 conformance target is `apps/sdk/src/services/mock-scenarios.ts` — the real backend's output must be shape-compatible with what those scenarios emit.

```
SSE event types: part_start | token | thinking_step | part_complete | done | error
fields: messageId, partIndex, partType (text|thinking|menu|file|image|card),
        content, step{id,label,detail?,status,data?}, message, part (full payload for menu|file|image|card)
```

### Current backend (from exploration)

- **Inference route** `apps/web-ui/app/api/v1/inference/route.ts` (POST, `format=sse`) iterates `streamChat().textStream` (~L485) and writes only `{type:'token'}` / `{type:'done'}` / `{type:'error'}` (~L488–534).
- **AI layer** `libs/ai` wraps the Vercel AI SDK `streamText()` over Amazon Bedrock. **MCP tool-calling is already wired** (`buildMcpToolsForAgent`, `tools`, `maxSteps`) but tool steps are not streamed.
- **Persistence** `InferenceSessionMessage.content String @db.Text`, plus `attachments Json?`. No `parts` column. `InferenceSession` has `channelMetadata Json?` (channel-connector data) and a 30-min idle expiry.
- **Workers** (pg-boss) are all async post-processing (analytics, idle-watcher, ingestion) — **none are in the synchronous chat path**. Therefore parts must be emitted from the inference route's stream, not a worker.
- **Multimodal input** exists (`libs/ai/src/content-resolver.ts` — S3 fetch, image/PDF/Word extraction). **Output generation does not.**

---

## 2. Goals & Non-Goals

### Goals

- Emit the full Phase 1 SSE contract from the real inference route by tapping `streamText().fullStream`.
- Source thinking steps from real **tool-call / tool-result** events.
- Add a per-agent **workflow tree** schema + a small deterministic **execution engine** that runs before the LLM and drives server-driven menus.
- Add **file-generation tools** (`generate_spreadsheet`, `generate_pdf`) that render → upload to S3 → return a signed URL, surfaced as `file` parts.
- **Persist** rich parts on session messages (`parts JSONB`) so resumed sessions rehydrate real parts.
- Keep the orchestration in **`libs/ai` + `libs/shared`** (where unit tests run), keeping the inference route thin.
- Ship a **conformance test** proving the real emitter's output matches the Phase 1 mock contract.

### Non-Goals (explicitly out of scope)

- Designer/authoring UI for workflows or thinking-visibility — **Phase 3**.
- Any widget rendering change — **Phase 1, done**.
- Native model reasoning-token ("chain of thought") thinking — **rejected**; we use real tool steps.
- LLM-improvised menus via a `present_menu` tool — **rejected**; menus come from the workflow tree.
- Image-generation output — out of scope for Phase 2 (the `image` part type remains mock-only until a later phase). Phase 2 produces `file` parts (PDF/spreadsheet); the `image` producer is deferred.

---

## 3. Architecture

Three new units plus two supporting pieces. The orchestration lives in the libraries that have a working test harness; the 769-line route stays thin.

```
apps/web-ui/app/api/v1/inference/route.ts   (thin) ── consults ──► WorkflowEngine (libs/shared)
                     │                                                    │
                     │ on workflow miss                                   │ on match
                     ▼                                                    ▼
            PartStreamEmitter (libs/ai) ──► AsyncGenerator<StreamEvent>   scripted node parts
                     │                                                    │
                     └──────────────► SSE writer (route) ◄────────────────┘
                                              │
                                              ▼
                                  InferenceSessionService.appendMessage({ parts })
```

### 3.1 `PartStreamEmitter` (`libs/ai`)

Wraps `streamText().fullStream` and returns `AsyncGenerator<StreamEvent>`. **Sole owner of `partIndex` bookkeeping** (the off-by-one risk flagged in the Phase 1 review is isolated here and unit-tested). Mapping from `fullStream` chunk types to the contract:

| fullStream chunk | Emitted event(s) |
|---|---|
| first `tool-call` | open thinking part: `part_start{partType:'thinking'}`, then `thinking_step{status:'active'}` |
| subsequent `tool-call` | `thinking_step{status:'active'}` (new step id) |
| `tool-result` (non-file tool) | `thinking_step{status:'done', data?}` patching the matching step |
| `tool-result` (file-gen tool) | `part_complete` (thinking, if open) → `part_start{partType:'file', part}` → `part_complete` |
| first `text-delta` | if thinking open: `part_complete` it; then `part_start{partType:'text'}` |
| `text-delta` | `token` |
| `finish` | `part_complete` (text) → `done` |
| stream throw / `error` chunk | `error{message}` (partial parts preserved) |

Step labels derive from the tool name via a small humanizer (e.g. `search_knowledge_base` → "Searching knowledge base"); optional `data` cards come from compact tool-result metadata (e.g. `{hits:'4'}`). The emitter accumulates the final `MessagePart[]` so the route can persist it.

### 3.2 `WorkflowEngine` (`libs/shared`)

Owns the workflow-tree schema and execution. Pure, synchronous resolution:

```
resolve(definition, incomingValue, cursor): { events: StreamEvent[]; nextCursor: WorkflowCursor | null } | null
```

- Returns `null` when the engine should defer to the LLM (no active workflow, or incoming value matches no transition and the node isn't the entry trigger).
- On match, returns the next node's parts already shaped as `StreamEvent`s and the advanced cursor.
- Guards against cycles / missing nodes (bounded traversal; a malformed definition resolves to `null` → LLM fallback, never a dead-end).

### 3.3 Thin route changes

In `apps/web-ui/app/api/v1/inference/route.ts`, replace the `textStream` SSE block:

1. Load active `AgentWorkflow` for the agent; read `workflowState` cursor from the session.
2. `WorkflowEngine.resolve(...)`:
   - **Match** → write the returned events to SSE, persist parts, save `nextCursor`, `done`.
   - **Miss/null** → build toolset (existing MCP tools + file-gen tools), run `PartStreamEmitter` over `streamText().fullStream`, relay each event to SSE, persist accumulated parts.
3. All existing auth, tenant scoping, `ApiKeyExecution` tracking, and webhook delivery are preserved.

### 3.4 File-generation tools (`libs/ai`)

Two fixed tools (decided over one generic tool — clearer affordances + typed args for the LLM):

- `generate_spreadsheet({ filename, columns, rows })` → renders XLSX (e.g. `exceljs`)
- `generate_pdf({ filename, title, sections })` → renders PDF (e.g. `pdfkit`)

Both: render in-memory → upload to existing S3 (reuse the `ContentResolver`/S3 access in `libs/ai`) → return `{ url, name, mimeType, sizeBytes }` with a **signed, TTL-bounded URL**. The emitter turns the tool-result into a `file` part.

### 3.5 Persistence

- Migration: add `parts Jsonb?` to `InferenceSessionMessage`.
- `content String @db.Text` is **kept** as a denormalized concatenation of text-part text (embeddings, KB search, and back-compat depend on it). `parts` is the render source of truth.
- Migration: add `workflowState Json?` to `InferenceSession` (dedicated column — chosen over overloading `channelMetadata`, which carries channel-connector data).
- `InferenceSessionService.appendMessage()` extended to accept and persist `parts`.

---

## 4. Workflow Tree Schema (what Phase 3 will author)

New Prisma model:

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
}
```

`definition` (validated by a Zod schema in `libs/shared`, the authoritative contract for Phase 3):

```ts
interface WorkflowDefinition {
  entryNodeId: string;
  nodes: WorkflowNode[];
  transitions: WorkflowTransition[];
}
type WorkflowNode =
  | { id: string; type: 'menu'; title?: string; options: { label: string; value: string; icon?: string }[] }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'file'; fileRef: string };   // static, pre-uploaded
interface WorkflowTransition { fromNodeId: string; optionValue: string; toNodeId: string }
```

`WorkflowCursor` = `{ nodeId: string }`, stored in `InferenceSession.workflowState`. A turn whose incoming value matches a transition from the cursor node advances to the target node; the engine emits that node's parts (and, if it's a `menu`, the next menu). Reaching a node with no outgoing transitions ends the workflow (clears the cursor) and subsequent turns flow to the LLM.

This schema is deliberately exactly what the Phase 3 designer edits and persists.

---

## 5. SSE Contract Conformance (the binding interface)

Phase 2 emits the identical event shapes Phase 1 mocks. The authority is `apps/sdk/src/types/index.ts` (`StreamEvent`, `MessagePart`) and `apps/sdk/src/services/mock-scenarios.ts`. To prevent drift, the **shared event/part types are extracted into a single source** consumed by both `libs/ai` (producer) and the SDK (consumer) — or, if cross-package import is impractical, duplicated with a conformance test asserting structural equality. A test feeds a scripted `fullStream` through `PartStreamEmitter` and asserts the output matches the `thinking` and `files` mock scenarios' event sequence.

---

## 6. Data Flow (one turn)

1. Widget POSTs a message — free text **or** a menu option's `value` (Phase 1 already sends option `value` as a normal user message).
2. Route loads the agent's active workflow + the session cursor, calls `WorkflowEngine.resolve`.
3. **Workflow match** → stream scripted node events, persist parts, advance `workflowState`, `done`. (No LLM call.)
4. **Miss** → build toolset, run `PartStreamEmitter` over `streamText().fullStream`, relay events, accumulate + persist parts, `done`.
5. The user (`role:'user'`) message is persisted before the turn (existing behavior); the assistant message is persisted with its `parts` after streaming completes (extends existing ~L506 append).

---

## 7. Error Handling & Resilience

- **Stream error** → emitter emits `error`; route persists partial parts with message `status:'error'`. Widget shows inline Retry (Phase 1, wired).
- **File-gen tool failure** → the tool returns an error result; the turn continues (the model can apologize / retry); no hard crash.
- **Workflow resolve throw / malformed definition** → caught, falls back to the LLM path. Never dead-ends the user.
- **Signed-URL expiry** → the widget's `file` part already has a retry/error affordance (Phase 1).
- All new async paths wrapped in try/catch and logged via the shared Pino logger with `{tenantId, agentId, sessionId}` context (per project standards).

---

## 8. Testing

The payoff of putting orchestration in the libraries (where `bunx vitest` runs cleanly — 134 lib/service tests already pass; the SDK component-harness issue does **not** apply here):

- **`PartStreamEmitter`** — feed a fake `fullStream` (array of typed chunks) → assert exact `StreamEvent` sequence + `partIndex` correctness, across: text-only, tool-call→tool-result→text, file-gen tool, mid-stream error. **Keystone test.**
- **`WorkflowEngine`** — given definition + value + cursor → assert emitted events + `nextCursor`; edges: entry trigger, no-match (→ null), terminal node (clears cursor), cycle/missing-node guard.
- **File-gen tools** — render + upload with a mocked S3 client; assert the returned `file`-part shape.
- **Conformance** — emitter output vs. Phase 1 `mock-scenarios.ts` shapes (§5).
- **Route** — thin; covered by an integration-level check that workflow-match vs. LLM-fallback dispatch is correct (mock the engine + emitter).

All env vars via T3 Env; request bodies validated with Zod at the route boundary (per project standards).

---

## 9. Migration & Back-Compat

- Two additive migrations: `InferenceSessionMessage.parts Jsonb?`, `InferenceSession.workflowState Json?`, plus the new `AgentWorkflow` table. All nullable/new — no backfill required.
- Existing sessions with no `parts` rehydrate via the Phase 1 fallback (`content` → one text part), which the widget already handles.
- Agents with no `AgentWorkflow` (the default) simply always take the LLM path — the workflow engine is opt-in per agent.
- The non-SSE / `format=json` response path and the graph-agent trace are unchanged.

---

## 10. Definition of Done (Phase 2)

- The inference route emits the full Phase 1 SSE contract via `PartStreamEmitter` over `fullStream`.
- Real tool calls render as a thinking timeline in the widget against the live backend.
- A configured `AgentWorkflow` drives a multi-step server-driven menu walk end-to-end, with the cursor persisted across turns.
- `generate_spreadsheet` / `generate_pdf` produce downloadable artifacts surfaced as `file` parts with signed URLs.
- Rich parts persist on `InferenceSessionMessage.parts` and rehydrate on session resume.
- Conformance test proves emitter output matches the Phase 1 mock contract.
- Emitter, engine, and file-gen tools are unit-tested and green; the route stays thin.
- Errors (stream failure, tool failure, malformed workflow) degrade gracefully, never dead-end.

---

## 11. Interfaces Handed to Phase 3

- `WorkflowDefinition` Zod schema + `AgentWorkflow` model — the designer authors and persists these.
- A "thinking visibility" toggle and per-agent config surface are **named but not built** here; Phase 3 owns the authoring UI. Phase 2 only needs the `isActive` flag and `definition` to be readable by the engine.
