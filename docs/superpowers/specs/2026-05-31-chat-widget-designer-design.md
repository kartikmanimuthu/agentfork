# Chat Widget Redesign — Phase 3: Designer Config UI

**Date:** 2026-05-31
**Status:** Approved design, ready for implementation planning
**Scope:** Phase 3 of 3 (designer/authoring UI; consumes Phase 1 widget + Phase 2 backend)

---

## 1. Background & Motivation

Phase 1 built the message-parts chat widget (`apps/sdk`). Phase 2 made the real backend emit the parts contract — thinking timelines from tool steps, server-driven menus from a config **workflow tree**, and file artifacts. Phase 2 shipped the data model (`AgentWorkflow`, `workflowDefinitionSchema`) but **no authoring UI**: a workflow tree can only be inserted by hand into the database.

Phase 3 is that authoring front-end. A tenant admin gets a visual editor to author the workflow tree for an agent, activate it, and control thinking visibility — all in the existing dashboard.

### What already exists (from exploration)

- **Agent edit page** `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx` — tabbed (Configuration, Knowledge Bases, MCP Servers, Versions, API Keys); graph agents render a React Flow canvas here.
- **React Flow canvas** `apps/web-ui/components/agents/canvas/agent-canvas.tsx` + `node-palette.tsx` — `@xyflow/react` ^12, drag-from-palette, edge drawing, save via PUT. The reuse target.
- **Forms** use `@tanstack/react-form` + Zod (e.g. `SimpleAgentForm`).
- **Service pattern** `SdkWidgetService` (`libs/shared/src/services/sdk-widget-service.ts`): `create/findById/update/delete/listByTenant`.
- **API convention** `apps/web-ui/app/api/agents/[id]/route.ts`: `getSessionTenantId(authOptions)` → `authorize(action, subject, authOptions)` → Zod `safeParse(body)` → service → `NextResponse.json`.
- **Phase 2 contracts** (consume, don't redefine): `workflowDefinitionSchema`, `WorkflowDefinition`, `WorkflowNode`, `WorkflowTransition` from `@chatbot/shared`; `PartStreamEmitter` in `libs/ai`.
- **`Agent` model**: `id, tenantId, name, type, status, config Json, …`, relation `workflows AgentWorkflow[]` (added in Phase 2). No thinking field yet.
- **`AgentWorkflow` model** (Phase 2): `id, agentId, tenantId, version, isActive, definition Json` + `agent` relation.
- **shadcn/ui**: 63 components installed (form/field, input, select, dialog, sheet, tabs, card, switch, accordion, sonner, …). No tree/graph primitive beyond React Flow.

---

## 2. Goals & Non-Goals

### Goals

- A **"Workflow" tab** on the agent edit page with a **React Flow canvas** to author the workflow tree (menu/text/file nodes; transitions = edges from each menu option to a target node).
- A pure, unit-tested **`graph ↔ WorkflowDefinition` mapping** module — the keystone that converts the canvas to the Phase 2 contract and back.
- **Persistence**: `AgentWorkflowService` + `/api/agents/[id]/workflows` routes; one workflow row per agent (single-draft model); an **activate toggle** that flips `isActive`.
- A **thinking-visibility toggle** (`showThinking`) authored in the same tab, honored end-to-end: a small `PartStreamEmitter` option suppresses thinking events when off (tool calls still run).
- A **live preview** reusing the existing iframe + Phase 1 mock transport so the author sees rendering without the live backend.
- Client + server validation so a malformed workflow cannot be activated.

### Non-Goals (deferred)

- Versioned workflow history / multiple workflows per agent (the `version` column stays `1`, reserved).
- Dynamic per-node signed file URLs (static `fileRef` only, per Phase 2).
- Image-output authoring (no `image` producer yet).
- Full live-backend preview (mock-transport preview only).
- Unit-testing interactive canvas behavior (verified manually / e2e — see §7).

---

## 3. Placement & UI Structure

A new **"Workflow" tab** on `agents/[id]/edit`. It is agent-scoped (matches `AgentWorkflow.agentId`), reuses the page's tab shell, and does not touch the chat-widget designer page. The tab contains three regions:

1. **Canvas** (main) — the React Flow editor (§4).
2. **Node inspector** (right, an inline side panel — kept visible beside the canvas, not a slide-over, so editing and graph stay in view together) — edit the selected node's fields.
3. **Tab header controls** — `Activate` switch (`isActive`), `Show thinking` switch (`showThinking`), `Save` button, validation status.

A **Preview** affordance (button → shadcn `Dialog`) renders the SDK widget via the mock transport (§6).

---

## 4. Workflow Canvas (React Flow)

Reuse the `@xyflow/react` scaffold from `components/agents/canvas/`. New components live under `apps/web-ui/components/agents/workflow/` (sibling, not a fork of the agent canvas).

- **Node palette** — drag to add `menu` / `text` / `file` nodes (mirrors `NodePalette`'s `dataTransfer` pattern).
- **Menu node** — card with editable title + an option list; **each option renders its own right-edge source handle** (handle id = the option's `value`). You draw one edge per option to its target node, so option→target is visually explicit.
- **text node** — single body field; **file node** — a `fileRef` field. Both are edge targets; neither has option handles.
- **Entry node** — the node with no inbound edges; the client validates exactly one entry.
- **Inspector** — edit selected node fields: menu (title + per-option label/value/icon), text (body), file (fileRef). Uses `@tanstack/react-form` + shadcn inputs.

### 4.1 The keystone: `graph ↔ WorkflowDefinition` mapping

A pure module `apps/web-ui/components/agents/workflow/workflow-graph.ts` (plain functions, no React):

- `graphToDefinition(nodes, edges): WorkflowDefinition` — entry = the node with no inbound edge; each edge `(sourceNodeId, sourceHandle=optionValue) → targetNodeId` becomes a `WorkflowTransition { fromNodeId, optionValue, toNodeId }`; node payloads map to `WorkflowNode`s.
- `definitionToGraph(def): { nodes, edges }` — inverse, with a deterministic auto-layout (simple top-down tiering) when nodes lack saved positions.
- `validateGraph(nodes, edges): GraphError[]` — exactly one entry; every menu option value unique within its node; every edge's source handle matches an existing option; no edge to a missing node; no node unreachable from entry (warn).

This module is the unit-test target. The canvas component is a thin React Flow shell over it.

---

## 5. Persistence: Service + API

### 5.1 `AgentWorkflowService` (`libs/shared/src/services/agent-workflow-service.ts`)

Mirrors `SdkWidgetService` (constructor-injected db for testability):

- `getByAgent(agentId): AgentWorkflowRecord | null` — the single row.
- `upsert(agentId, tenantId, definition): AgentWorkflowRecord` — create if absent, else update `definition`; preserves `isActive`.
- `setActive(agentId, isActive): void` — flip the flag.

One row per agent (single-draft model). `version` stays `1`.

### 5.2 API routes `/api/agents/[id]/workflows`

Follow the established convention (`getSessionTenantId` → `authorize` → Zod → service → `NextResponse.json`, with 401/403/500 handling and a scoped Pino logger):

- `GET /api/agents/[id]/workflows` — load the agent's workflow (or null).
- `PUT /api/agents/[id]/workflows` — body validated by `workflowDefinitionSchema.safeParse`; `upsert`.
- `POST /api/agents/[id]/workflows/activate` — body `{ isActive: boolean }`; `setActive`.

`authorize('update', 'Agent', …)` gates writes (workflows are an agent capability; no new RBAC subject).

### 5.3 Thinking flag

Add `showThinking Boolean @default(true)` to the `Agent` model (migration via `bunx prisma db push` — additive, project convention; existing agents default to `true`, matching Phase 2's current always-on behavior). It lives on `Agent` (not `AgentWorkflow`) because thinking applies on the LLM path too, where no workflow row may exist. The designer toggle persists it through the **existing** `PATCH /api/agents/[id]` route (extend its update schema to accept `showThinking`); no new route is added for this flag.

---

## 6. Thinking-Visibility — Cross-Phase Wiring

The Phase 2 `PartStreamEmitter` currently always opens a thinking part on the first tool call. Phase 3 makes it conditional:

- `PartStreamEmitter` constructor gains an options arg `{ showThinking?: boolean }` (default `true`). When `false`, `onToolCall` opens **no** thinking part and pushes **no** `thinking_step` (the tool still executes; only the UI events are suppressed). Because no thinking part is created, the first text part is `partIndex 0` and all indexing stays consistent — this is why suppression lives in the emitter, not a post-hoc filter in the route.
- The inference route reads `agent.showThinking` (already loading the agent) and passes `{ showThinking }` into `new PartStreamEmitter(messageId, { showThinking })`.

This is the one backend change Phase 3 carries; it extends the existing Phase 2 emitter unit test rather than adding new infrastructure.

---

## 7. Error Handling & Testing

### Validation
- **Client**: `validateGraph` runs before save; inline errors (missing/multiple entry, dangling transition, duplicate option value, edge to missing node). Save disabled while invalid. Activation disabled unless the saved definition is valid.
- **Server**: `workflowDefinitionSchema.safeParse` at the route boundary → 400 on failure. A malformed definition can never be persisted or activated.
- **Engine**: Phase 2 already falls back to the LLM path on a missing/malformed active workflow — no dead-ends.

### Testing
- **`workflow-graph.ts`** (keystone) — unit tests for `graphToDefinition`/`definitionToGraph` round-trip, entry detection, option→transition mapping, and every `validateGraph` rule. Runs in the Next/Vitest setup that works (not the broken SDK render harness).
- **`AgentWorkflowService`** — unit tests with an injected fake db (mirrors the Phase 2 `inference-session-service` test).
- **API routes** — validation/dispatch tests (auth, Zod reject, service call).
- **`PartStreamEmitter` `{ showThinking:false }`** — extends the Phase 2 emitter test: a tool-call+text stream emits no thinking events and text is `partIndex 0`.
- **Canvas interactions** (drag, edge-draw, inspector edits) — verified **manually / e2e**, explicitly NOT unit-covered. All mandatory standards apply: Zod validation, T3 Env, shadcn/ui components, try/catch + Pino logging, no direct `process.env`.

---

## 8. Definition of Done (Phase 3)

- A "Workflow" tab on the agent edit page renders a React Flow canvas authoring menu/text/file nodes + option→node transitions.
- `graph ↔ WorkflowDefinition` mapping is pure and unit-tested; the canvas round-trips a definition without loss.
- `AgentWorkflowService` + `/api/agents/[id]/workflows` (GET/PUT/activate) persist and activate a single workflow per agent; writes validated by `workflowDefinitionSchema`.
- The `Activate` toggle makes a workflow live (Phase 2 engine reads `isActive`); a configured workflow drives a real multi-step menu walk end-to-end.
- `showThinking` is authored in the designer, persisted on `Agent`, and honored by `PartStreamEmitter` (off → no thinking events, indices intact).
- Live preview renders the widget via the Phase 1 mock transport.
- Client + server validation prevent activating a malformed workflow.
- Mapping/service/route/emitter units are green; canvas verified manually/e2e (stated as such).

---

## 9. Interfaces Consumed (closing the three-phase loop)

- From **Phase 1**: the SDK widget + mock transport (preview).
- From **Phase 2**: `workflowDefinitionSchema`/`WorkflowDefinition` (authored shape), `AgentWorkflow` model (persistence), `PartStreamEmitter` (extended with `showThinking`), the inference engine (reads `isActive`).

With Phase 3, the loop closes: author a workflow + thinking preference in the designer → backend emits the parts contract → widget renders it.
