# Claw on DeepAgents — replacing the hand-written graph

**Date:** 2026-08-08
**Status:** Design approved, ready for implementation planning
**Supersedes for the task path:** `docs/specs/2026-08-06-claw-agent-latency-redesign.md` §7 P3

## 1. Goal

Replace `libs/claw-studio/src/agent/claw-graph.ts` — 930 lines of hand-written
`StateGraph` — with `createDeepAgent` from the `deepagents` package, so that no
orchestration graph is maintained by hand.

This branch is one half of an experiment. The LangGraph implementation lives on
another branch; the two are compared by running them, not by a runtime switch.
**No executor interface, no per-run path parameter, no dual-path code.** That
simplification is deliberate and comes from the branch-based comparison.

### What "replace LangGraph" means precisely

LangGraph does not leave the dependency tree. `deepagents` declares
`@langchain/langgraph`, `@langchain/core`, `@langchain/langgraph-checkpoint`,
`@langchain/langgraph-sdk`, `langchain` and `langsmith` as **peer dependencies**
and "returns a compiled LangGraph graph." Every one of those peers is already
installed at a satisfying version except `langsmith`.

What changes is that we stop *writing* LangGraph: no `StateGraph`, no
`Annotation.Root`, no `addNode`/`addEdge`/`addConditionalEdges`, no routers. That
LangGraph remains underneath is a benefit here — the existing `PostgresSaver`
checkpointer and stream plumbing keep working unchanged.

### Success criteria

Ranked by the weighting agreed during design:

1. **Accuracy** — task outcomes no worse than the graph path.
2. **Cost** — fewer model calls and tokens per turn (the graph forces a planner
   call plus a reflect/revise cycle on every task turn).
3. **Latency** — lower time-to-first-token and total turn time.
4. **Maintainability** — ~1,000 lines deleted against ~300 written.

## 2. Scope

**In scope — the task path.** `planner → generate → tools → reflect → revise →
final` is replaced by the deepagents loop.

**Out of scope — shared and unchanged.** `memory_recall`, `evaluator`,
`clarify`, `respond` and `memory_save` keep their current behaviour. Memory
recall/save move from graph nodes to middleware (§4.3) but call the same
service and run at the same points in the turn.

**Explicitly out of scope:** the replay/eval harness. Comparison is manual,
branch against branch. If an automated harness is wanted later it gets its own
spec. `ClawRun.taskDescription`, `ClawRun.result` and
`ClawRunEvent.toolName`/`toolArgs`/`toolOutput` are sufficient to build one; note
both tables carry a 30-day `expiresAt`, so any eval corpus must be exported to
fixtures to stay reproducible.

**Untouched:** the 37 integration tool files, the whole memory system (pgvector,
reconcile judge, skill synthesis), `workspace-file-service.ts`,
`tool-classifier.ts`, the scheduler, `model-factory.ts`, and `persistence.ts` —
both `PostgresSaver` and `PostgresMemoryStore` are reused as-is.

## 3. Architecture

`createDeepAgent` takes everything needed as a parameter, so no forking of the
library is required. Verified against the `deepagents@1.12.2` type definitions:

```ts
createDeepAgent({
  model,          // BaseLanguageModel | string
  tools,          // StructuredTool[]
  systemPrompt,   // string | SystemMessage | SystemPromptConfig
  middleware,     // custom middleware
  backend,        // AnyBackendProtocol | BackendFactory
  checkpointer,   // BaseCheckpointSaver
  store,          // BaseStore
  interruptOn,    // Record<string, boolean | InterruptOnConfig>
  subagents,
  stateSchema,
  responseFormat,
})
```

### Mapping

| Claw today | deepagents |
|---|---|
| `plannerNode`, mandatory every turn | `write_todos` — a tool, invoked only when the work warrants it |
| `reflect` ↔ `revise` bespoke critique loop | Deleted. The agent loop iterates. |
| `mutative_approval_gate` + `interruptBefore` | `interruptOn` — carries tool name *and* args; approve / edit / reject |
| `generate`, `tools`, `final` nodes | The loop |
| `ToolNode` + 37 integration tools | `tools: [...]` — same `@langchain/core/tools` type, unchanged |
| `PostgresSaver` | `checkpointer` — unchanged |
| `getRecentMessages(messages, 25)` | `createSummarizationMiddleware` |
| `prompt-composer` surfaces | `systemPrompt: SystemPromptConfig` + `createMemoryMiddleware` |
| Workspace files as DB rows | `StoreBackend` over `PostgresMemoryStore` (§4.2) |
| pgvector semantic memory | Custom middleware calling the existing service (§4.3) |

## 4. The three integration points

### 4.1 Approvals

`interruptOn` is a per-tool map built from the existing `tool-classifier.ts`
plus the live `grantedWrites` set from `file-tools.ts`, exactly as the graph's
router does today.

This is strictly better than the current gate and **fixes a known bug**: the
issue recorded in `libs/claw-studio/CLAUDE.md` is that `interruptBefore` pauses
*before* `mutative_approval_gate` runs, so `pendingToolApprovals` is still empty
at the moment of the pause and an approval prompt can reach a channel with an
empty tool list. `interruptOn` carries the tool name and arguments at the pause,
so the prompt is always populated.

### 4.2 Workspace files — `StoreBackend`

Claw's six workspace files (`identity`, `soul`, `agents`, `user`, `tools`,
`heartbeat`) are Postgres rows, not files. The prior evaluation rejected
`deepagents` partly because `createFilesystemMiddleware` "would duplicate and
conflict" with that model.

**That objection assumed disk is the only backend, and it is not.** `backend` is
a first-class `createDeepAgent` parameter typed `AnyBackendProtocol |
BackendFactory`, and `BackendProtocolV2` is a small interface — `ls`, `read`,
`readRaw`, `write`, `grep`, `glob`, `execute`.

**Correction (verified 2026-08-08).** An earlier draft proposed reusing
deepagents' built-in `StoreBackend` over `persistence.ts`'s
`PostgresMemoryStore`. **That does not work.** `PostgresMemoryStore` implements a
local `MemoryStoreInterface { batch(ops, config) }`, not LangGraph's `BaseStore`,
and its `batch()` writes **SEMANTIC memories into `claw_memories` with
embeddings**. Routing workspace files through it would embed every file write,
insert files into the memory table as spurious memories, never touch
`claw_workspace_files`, and lose revision history.

Instead, implement `BackendProtocolV2` **directly over `WorkspaceFileService`**
— no store abstraction in between. This keeps rows in `claw_workspace_files`,
preserves `ClawFileRevision` audit (reason + `sourceRunId`), avoids embeddings
entirely, and honours `SLUG_CHAR_CAPS`. Paths map to the six slugs
(`/identity.md` ↔ `identity`, etc.); `execute` is unsupported and returns an
error string.

`createMemoryMiddleware({ backend, sources })` loads named markdown files into
the system prompt — which is what `prompt-composer` does by hand. The six
workspace files become its `sources`, preserving the surface model (`speaking`
gets identity/soul/agents/user; `acting` adds tools; `scheduled` adds
heartbeat).

Self-authoring keeps working: deepagents' filesystem tools write through the
same backend, with `permissions` / `FilesystemPermission` expressing the
free-write vs gated-write split from `self-authoring-policy.ts`.

`DEFAULT_IDENTITY` and the non-regression guarantee in `prompt-composer.test.ts`
are unaffected — a tenant with no files must still compose to `''`.

### 4.3 Semantic memory — custom middleware

`deepagents` has **no semantic memory.** Its `createMemoryMiddleware` loads
prompt files; there are no embeddings, no vector recall, no similarity search.

Claw's memory is therefore carried across unchanged and remains the most
domain-specific code in the library: `claw_memories` with 1024-dim pgvector and
an HNSW index, `SEMANTIC`/`EPISODIC`/`PROCEDURAL` kinds, distance-threshold
recall, the reconcile judge, working memory, and skill synthesis into `sys-*`
skills.

One custom middleware wraps the loop: recall before the model runs, save after
the turn completes. Both call `memory-service.ts` and `memory-nodes.ts` as they
are. Synthesis continues to fire from the save path.

Memory failures stay non-fatal, matching today's behaviour (a failed embedding
degrades to recency text search rather than aborting the turn).

## 5. UI events

The run timeline is currently derived from graph node names by
`deriveNodeEvents` in `gateway/execute-run.ts`. With no nodes, those labels
cease to exist — not as a shortcut, but because the steps they named no longer
happen.

v1 emits into the existing `ClawRunEvent` shape:

- `tool_call` / `tool_result` for every tool, with `toolName`, `toolArgs`,
  `toolOutput` — unchanged, and the part actually used for debugging
- `status` for run lifecycle
- `content` for assistant text
- `node` left `null` (the column is `String?`) or set to a coarse label such as
  `agent`; consumers must already tolerate null and no longer key behaviour off it

Lost: the fixed `Planning` / `Reflecting` / `Revising` labels.
Gained: when work is complex, the `write_todos` call surfaces a real plan rather
than a generic phase name.

## 6. Files

**New (3)**

| File | Purpose |
|---|---|
| `agent/claw-deep-agent.ts` | `createDeepAgent` composition root; replaces `claw-graph.ts` |
| `agent/workspace-backend.ts` | `ClawWorkspaceBackend implements BackendProtocolV2` over `WorkspaceFileService` |
| `memory/memory-middleware.ts` | Recall before / save after, calling the existing memory service |

**Modified (5)**

| File | Change |
|---|---|
| `agent/claw-runtime.ts` | Build the agent instead of the graph; `recursionLimit` arithmetic no longer applies |
| `gateway/execute-run.ts` | Event derivation from the agent stream; approval via `interruptOn` instead of `getState().next` + `updateState` |
| `apps/mission-control/app/api/chat/route.ts` | Stream shape |
| `apps/mission-control/app/api/playground/route.ts` | Stream shape |
| `package.json` | Add `deepagents`, `langsmith` |

**Deleted**

| File | Reason |
|---|---|
| `agent/claw-graph.ts` | ~930 lines; the graph being replaced |
| `agent/executor-state.ts` | The 22-channel `Annotation.Root`. Most channels exist only to pass data between nodes and die with them; any genuinely still needed (e.g. accumulated memory stats) are re-declared as a small `stateSchema` on `createDeepAgent` rather than carried over wholesale. Auditing which channels survive is the first task of implementation. |
| `agent/claw-agent.ts` | The P3 `createAgent` spike, superseded by this design |

Net: roughly 1,000 lines deleted, ~300 written.

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | ~~`StoreBackend` ↔ `PostgresMemoryStore` protocol fit.~~ **Resolved 2026-08-08 — the assumption was false.** See §4.2. | Closed by design change: implement `BackendProtocolV2` directly over `WorkspaceFileService`. No store abstraction, no embeddings, no `claw_memories` pollution. |
| 2 | `REQUIRED_MIDDLEWARE_NAMES` is exported — deepagents may force its filesystem middleware on. | Check early. If forced, workspace files route *through* it rather than beside it; §4.2 still holds since the backend is what matters. |
| 3 | Token streaming. `claw-graph.ts` uses `getWriter()` with a documented workaround to emit deltas. | Confirm deepagents' stream exposes an equivalent. If not, the UI loses token streaming and falls back to whole-message delivery. |
| 4 | **Behaviour drift.** No guaranteed reflect→revise; quality may move either way. | This is the experiment's core question. Detected by branch-vs-branch comparison, not prevented. |
| 5 | Approval rewiring changes `approvalRequestFrom` in `execute-run.ts`. | Covered by risk 1's ordering — do approvals after the backend is proven. |

## 8. Testing

Per `libs/claw-studio/CLAUDE.md`:

- Tests run with `cwd=libs/claw-studio` (`bunx vitest run`); the config's
  `include` is relative to that directory.
- Many are integration-style against the real local Postgres. `vi.mock` does not
  reliably intercept relative-module imports in this package — a verified
  environment issue. Follow the existing pattern rather than fighting it.
- `tool-classifier.test.ts` pins real tool names on both sides; any tool added
  or renamed must be added to those lists.
- `prompt-composer.test.ts` and `prompt-templates.test.ts` pin the
  non-regression guarantee. `DEFAULT_IDENTITY` must not change.

New coverage needed: workspace-file read/write through `StoreBackend`, memory
middleware firing at the right points, and `interruptOn` pausing on the same
tool set the classifier gates today.

## 9. Decisions taken

| Decision | Choice |
|---|---|
| Runtime switch between paths | **None.** Comparison is branch vs branch. |
| Scope | Task path only; memory and routing shared. |
| Semantic memory | Stays Claw's own; deepagents has no equivalent. |
| Workspace files | `BackendProtocolV2` implemented directly over `WorkspaceFileService`. |
| Approvals | `interruptOn` (human-in-the-loop middleware). |
| `claw-agent.ts` | Deleted. |
| Eval harness | Deferred to its own spec. |
| UI events | Coarse for v1; tool detail preserved, phase labels dropped. |
