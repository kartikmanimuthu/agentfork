# Claw Agent — Accuracy & Latency Redesign

**Status:** Research + proposed plan (pre-implementation)
**Date:** 2026-08-06
**Author:** Adya Tiwari + Claude
**Problem:** Unnecessary planning on conversational turns; reflect↔revise loops running to the
cap; slow final responses.
**Method:** Production run data from `claw_runs` / `claw_run_events` (hosted DB), plus a line-level
read of `libs/claw-studio/src/agent/`.

---

## 0. TL;DR

Three independent defects compound into the symptom. In severity order:

1. **The reflect↔revise cycle is unbounded.** `iterationCount` is incremented in exactly one
   place — `generateNode` (`claw-graph.ts:434`) — but both loop guards read it. A
   `reflect → revise → reflect` cycle advances **no counter at all**, so it runs until LangGraph's
   `recursionLimit` throws and the entire turn is lost. This is the "continuous loops of planning
   and reflecting until it hits the max limit" being reported, and it is a plain bug, not a
   tuning problem.
2. **There is no conversational path.** Every turn — including `"hi"` — runs
   `memory_recall → evaluator → planner → generate → final → memory_save`: **5 sequential LLM
   calls minimum** for a greeting. The proposed task/conversation split is the right fix.
3. **Nothing is token-streamed.** All 6 call sites are `.invoke()`; the reply is emitted as one
   lump `event: token` after the graph completes (`chat/route.ts:113-115`). Perceived latency =
   the sum of every sequential call, so fixes 1 and 2 are partly masked without this.

**Library verdict:** Haystack is **Python-only** — not viable in this Bun/TS monorepo, at any
scale of effort. DeepAgents (`deepagents@1.10.7`, TS port) *is* drop-in version-compatible, and
its core idea — planning as a **tool the model calls when needed**, not a mandatory node — is
exactly the correction needed. Recommendation is to **adopt the pattern now and evaluate the
dependency later**, because a wholesale migration would put HITL approvals, tenant scoping,
workspace files, skills and connectors — all of which work — at risk for no accuracy gain.

---

## 1. Evidence from production runs

Queried from the hosted DB. Event counts are per `claw_run_events.node`.

| Run | Input | generate | tools | revise | reflect | Total LLM | Wall |
|---|---|---:|---:|---:|---:|---:|---:|
| `run_VimLCfF9…` | "show all tasks assigned to Omar in Jira…" | 106 | 121 | 21 | 7 | ~134 | **968s** |
| `run_dSAe-l8…` | "Can u list any excel sheet i have on my drive?" | 19 | 39 | **57** | 36 | ~112 | 725s → **failed** |
| `run_MtHblj…` | "whats your name?" | 1 | 0 | 0 | 0 | 4 | 22s |
| `run_UydIe_0…` | "what is your name?" | 1 | 0 | 0 | 0 | 4 | **536s** |
| `run_zELnMp…` | "hi" | — | — | — | — | — | → `awaiting_input` |

Aggregate across all runs: `tools 192, generate 164, revise 87, reflect 53`. **140 of 304 node
executions are reflect/revise overhead** rather than productive work.

Two things stand out:

- `run_dSAe` ran **revise 57 times against generate 19** — it was thrashing in the critique loop,
  not making progress, and died on `Recursion limit of 110 reached` (the error text is still in
  that row). `iterationCount` had only reached 19, well under the cap of 30 — proving the guard
  never engaged.
- `"what is your name?"` and `"whats your name?"` have **identical node profiles but 22s vs 536s**
  wall time. The graph shape doesn't explain that spread; per-run setup does (§3.4).

---

## 2. Root cause 1 — the unbounded reflect↔revise cycle

```ts
// claw-graph.ts:434 — the ONLY increment in the graph
return { messages: [response], iterationCount: iterationCount + 1, plan: updatedPlan };

// claw-graph.ts:612-614
function routeFromReflect(state) {
  return state.isComplete || state.iterationCount >= maxIterations ? 'final' : 'revise';
}

// claw-graph.ts:654-660
function routeFromRevise(state) {
  if (lastMessage.tool_calls?.length) return routeFromGenerateToTools(state);
  return 'reflect';                       // ← back to reflect, counter untouched
}

// claw-graph.ts:619-652 — reviseNode returns no iterationCount
return { messages: [response], nextAction: 'generate' };
```

If `reviseNode` emits no tool calls, control returns to `reflect`, which routes back to `revise`,
forever. The three real exits are: the reflector volunteering `isComplete: true`, the stall
detector, or `GraphRecursionError`.

**And the stall detector is effectively non-functional.** `computeReflectionStall`
(`agent-shared.ts:237-246`) requires `prevIssues === currentIssues` — byte-identical equality on
free-text prose the LLM rewrites every round, against an input that itself changes each round
(latest draft + `toolResults.slice(-5)`). Three consecutive identical strings are needed
(`stallCount >= 2`), and any single non-repeat resets the counter to 0. It fires reliably only for
the synthetic `'EMPTY_REFLECTION: …'` literal (`claw-graph.ts:556-559`).

So the practical bound is `recursionLimitFor(maxIterations) = maxIterations * 3 + 20`
(`claw-runtime.ts:50-52`) → **50 node steps for chat, 110 for background** — and the terminal state
of that worst case is an exception, not an answer.

---

## 3. Root cause 2 — no conversational path

### 3.1 The evaluator's mode is binary and neither value means "just answer"

`mode` is coerced to `'plan' | 'end'` at `claw-graph.ts:284`. `'end'` does **not** mean "answer
directly" — it routes to `clarifyNode`, which makes no LLM call and simply asks the user a
clarifying question, ending the turn in `awaiting_input`. That is why `"hi"` landed in
`awaiting_input` rather than getting a reply. The evaluator prompt states the rule outright:

> `- "plan" for every executable task — all runs are planned, executed, and reflected on`

### 3.2 Exact cost of `"hi"`

`START → memory_recall → evaluator → planner → generate → final → memory_save → END`

- `plannerNode` is unconditional, makes its own LLM call (`:356`), and its fallback **forces a
  minimum of one step** (`:365-367`). Its prompt pushes toward *more* steps ("smallest
  independently executable steps"), so a greeting can yield a 2–3 step plan.
- `generateNode` answers, then `routeFromGenerate` sends `iterationCount <= 1` straight to `final`
  — which **re-writes the answer from scratch**. Two full generations for one greeting.

**5 sequential LLM calls, of which 1 is useful.**

### 3.3 There is no removed "fast mode" to restore

`libs/claw-studio/CLAUDE.md` notes nucleus had legacy `'fast'` branches that were dead upstream.
Verified via `git log -S"fast" --oneline -- libs/claw-studio` and `git log --all -S"mode === 'fast'"`:
the only occurrence in the entire tree is the explanatory comment at `claw-graph.ts:21`. **The
conversational bypass never existed here** — it has to be built, not recovered.

### 3.4 Per-run setup cost (explains the 22s vs 536s spread)

`resolveClawRuntime` does the following *before* the graph starts, on every run:
`getCheckpointer` + `getMemoryStore`, `createMcpTools` (network), `createIntegrationTools`,
`loadAllSkillContent`, then `workspace.seed()`, `reseedUnedited()`, `asMap()` (3 DB round-trips).

`createIntegrationTools` (`integrations/index.ts:84-92`) loops **30 descriptors with a sequential
`await` per iteration**. Against a database now in `us-east-1` from India, that alone is seconds of
dead time per run — and it is trivially parallelisable.

Also: `model-factory.ts` sets `REQUEST_TIMEOUT_MS = 60_000` with `MAX_RETRIES = 2` (one hung node
can burn 180s), and the **Anthropic branch sets no timeout at all** — a genuine hang risk.

---

## 4. Root cause 3 — no token streaming, one model for every role

- **Zero streaming.** All 6 model calls in `claw-graph.ts` are `.invoke()`. `graph.stream()` in
  `chat/route.ts:79` streams *node transitions*, not tokens; the answer is one lump at
  `:113-115`. Time-to-first-token = total pipeline time.
- **One model for everything.** `reflectorModel` defaults to `model` (`claw-graph.ts:167`) and
  **no caller ever supplies it** (`claw-runtime.ts:197-212`) — despite its own doc comment
  describing it as the cheap non-streaming model for evaluator/reflect/final. Classification and
  critique run on the same full-size model as generation.

---

## 5. Library evaluation

### 5.1 Haystack — not viable

> "Haystack is the open source **Python** framework by deepset…"

Python-only. There is no JS/TS port. Using it would mean standing up a separate Python service and
an RPC hop for an agent loop that must share tenant DB state, HITL interrupts and the LangGraph
checkpointer. Its RAG value-add is also already covered here by `knowledge_bases` +
`document_chunks` + pgvector. **Reject.**

### 5.2 DeepAgents (TS) — right idea, adopt the pattern first

`deepagents@1.10.7` peer deps vs. what is installed:

| Peer dep | Required | Installed | OK |
|---|---|---|---|
| `@langchain/core` | `^1.2.0` | 1.2.3 | ✅ |
| `@langchain/langgraph` | `^1.4.4` | 1.4.8 | ✅ |
| `@langchain/langgraph-checkpoint` | `^1.1.2` | 1.1.3 | ✅ |
| `@langchain/langgraph-sdk` | `^1.9.23` | 1.9.27 | ✅ |
| `langchain` | `^1.5.0` | 1.5.3 | ✅ |
| `langsmith` | `^0.7.1` | — | add |

Drop-in compatible. Its architecture is a **single ReAct loop plus middleware**:

```ts
const builtInMiddleware = [
  todoListMiddleware(),                 // planning = write_todos TOOL, called when needed
  createFilesystemMiddleware({ … }),
  createSubAgentMiddleware({ … }),      // isolated context windows
  createSummarizationMiddleware({ … }), // auto history compaction
  createPatchToolCallsMiddleware(),
];
```

The decisive difference: **planning is a tool the model invokes when the task warrants it**, not a
graph node every turn must traverse. There is no forced reflect/revise cycle at all.

**But the dependency is not needed — the ideas already ship in the installed LangChain v1.**
`node_modules/…/langchain@1.5.3/dist/agents/middleware/` contains, verified by inspection:

| Middleware (installed) | Replaces / fixes in Claw |
|---|---|
| `todoListMiddleware()` | `plannerNode` — planning becomes the model-invoked `write_todos` tool |
| `humanInTheLoopMiddleware({ interruptOn })` | `mutative_approval_gate` + `interruptBefore` |
| `modelCallLimitMiddleware({ exitBehavior })` | the unbounded reflect↔revise cycle |
| `llmToolSelectorMiddleware({ maxTools })` | ~100 tools bound to every call |
| `summarizationMiddleware` / `contextEditing` | hand-rolled `getRecentMessages(messages, 25)` |
| `dynamicSystemPrompt` | `prompt-composer` surfaces (speaking/acting/scheduled) |
| `toolRetry`, `modelRetry`, `modelFallback`, `piiRedaction` | net-new, currently absent |

Two of these are decisive:

- **`todoListMiddleware`'s own system prompt already encodes the fix being asked for:**
  > "For simple objectives that only require a few steps, it is better to just complete the
  > objective directly and NOT use this tool. Writing todos takes time and tokens, use it when it
  > is helpful for managing complex many-step problems! But not for simple few-step requests."
- **`modelCallLimitMiddleware` supports `exitBehavior: 'end'`** — a bounded run *finishes with an
  answer* instead of throwing `GraphRecursionError` and losing the turn (§2).

`humanInTheLoopMiddleware` is also **strictly better than the current gate**: it is a per-tool map
(`true` → pause, `false`/absent → auto-approve) carrying `actionRequests` with tool name *and*
args, and supports `approve | edit | reject`. That maps cleanly onto `tool-classifier.ts` +
`grantedTools`, upgrades the current binary approve/reject to allow *editing* a tool call, and
incidentally fixes the outstanding bug recorded in `libs/claw-studio/CLAUDE.md` — that
`interruptBefore` pauses *before* `mutative_approval_gate` runs, so `pendingToolApprovals` is
still empty at the first pause and approval prompts can reach a channel with an empty tool list.

**Conclusion: do not add `deepagents`.** Its distinctive extras beyond the above are the
filesystem and subagent middleware — and Claw already has its own DB-backed workspace-file model
(`workspace/workspace-file-service.ts`) that `createFilesystemMiddleware` would duplicate and
conflict with. Adopt the pattern via `createAgent` + the middleware already on disk; revisit
`deepagents` only if subagent isolation becomes a real requirement (§7 P3-3).

### 5.3 Memory / RAG — keep what exists

`claw_memories` (+ HNSW pgvector), `claw_working_memory`, episodic capture, judge/distiller and
skills synthesis are more domain-specific than `langmem` offers, and are already tenant-scoped and
migration-managed. No reason to replace. The memory *nodes* do add LLM calls per run (§7 P0-5).

---

## 6. Target architecture

Split by intent, and make the task path a bounded ReAct loop:

```
                 ┌─ chat ──→ respond (1 streamed call) ──────────┐
memory_recall ──→ triage ─┼─ clarify ─→ (ask, END)               ├──→ memory_save → END
                 └─ task ──→ agent ⇄ tools ──→ (bounded) ────────┘
                                └─ plan/reflect as TOOLS, on demand
```

Principles:

1. **Conversation never plans.** Greetings, identity questions, chit-chat, and anything answerable
   from context resolve in one streamed call.
2. **Planning is a capability, not a phase.** Expose `write_todos`-style planning to the model for
   genuinely multi-step work; stop forcing it.
3. **Critique is bounded and rare.** Reflection runs at most N times per turn, on an explicit
   counter, and never on the conversational path.
4. **Every loop edge advances a counter.** No cycle may rely on `recursionLimit` as its bound.
5. **Stream the user-visible answer.** Time-to-first-token measured in ~1s, not in pipeline totals.

---

## 7. Plan

Ordered by (impact ÷ risk). P0 is pure bug-fixing with no architectural change.

### P0 — Stop the bleeding (~half a day, low risk)

- **P0-1 — Bound the reflect↔revise cycle.** Add a `reviseCount` channel to `ClawGraphAnnotation`,
  increment it in `reviseNode`, and make `routeFromReflect` exit to `final` at
  `reviseCount >= 2`. *Directly fixes the reported infinite-loop symptom.*
- **P0-2 — Make stall detection real.** Compare normalised issues (trim/lowercase/collapse
  whitespace, or a similarity threshold) instead of `===`. With P0-1 in place this becomes a
  secondary guard rather than the only one.
- **P0-3 — Parallelise `createIntegrationTools`.** Replace the sequential 30-iteration `await`
  loop with `Promise.all`. Seconds off every run.
- **P0-4 — Set a timeout on the Anthropic branch** in `model-factory.ts` to match Bedrock/OpenAI.
- **P0-5 — Route classification/critique to a cheap model.** Actually pass `reflectorModel` from
  `claw-runtime.ts` (e.g. Haiku) for evaluator/reflect/memory nodes. The plumbing already exists
  and is unused.

**Expected:** pathological runs stop hitting the recursion limit; every run loses several seconds
of setup; critique cost drops sharply.

### P1 — The conversation/task split (~1–2 days, medium risk)

- **P1-1** — Extend `RequestEvaluation.mode` to `'chat' | 'plan' | 'end'`; update the evaluator
  prompt so conversational turns, identity questions, and anything answerable from context/memory
  return `'chat'`. Remove the "plan for every executable task" instruction.
- **P1-2** — Add a `respondNode`: one call, persona + memory context + recent messages, no tools,
  no planner, no reflect. Route `chat → respond → memory_save → END`.
- **P1-3** — Skip `plannerNode` for single-step work on the task path (let `generate` run directly
  and call planning only when the model asks for it).
- **P1-4** — Guard against misclassification: if `respond` decides it needs a tool, fall through
  to the task path rather than answering wrongly. Accuracy must not be traded for speed.

**Expected:** `"hi"` goes from **5 LLM calls to 2** (triage + respond), and to 1 if triage is later
folded into the ReAct loop.

### P2 — Streaming (~1 day, low risk, large perceived win)

- **P2-1** — Token-stream the user-visible node (`respond`/`final`) via `streamMode: 'messages'`,
  emitting `token` deltas as they arrive instead of one lump at `route.ts:113-115`.
- **P2-2** — Keep the existing node-transition activity timeline for the task path.

**Expected:** time-to-first-token ~1s on conversational turns regardless of total pipeline time.

### P3 — Consolidate the task path onto `createAgent` + middleware (spike first)

No new dependency: every middleware below is already in `langchain@1.5.3` (§5.2).

- **P3-1 — Timeboxed spike (2–3 days), behind a flag, chat path only.** Stand up `createAgent`
  beside the existing graph — not replacing it — and prove the four things that could sink it:
  1. `humanInTheLoopMiddleware` interrupts resume correctly through the **existing Postgres
     checkpointer** and the gateway's `approvalRequestFrom` payload shape.
  2. `deriveNodeEvents` (`gateway/execute-run.ts`) can still produce the run timeline the UI and
     `ClawRunEvent` rows depend on, from `createAgent`'s stream shape.
  3. Tenant scoping and per-run tool construction survive (tools are already built per-run in
     `claw-runtime.ts`, so this should be mechanical).
  4. `dynamicSystemPrompt` reproduces `prompt-composer`'s surface rules **without touching
     `DEFAULT_IDENTITY`** — `prompt-composer.test.ts` / `prompt-templates.test.ts` must stay green.
- **P3-2 — If the spike holds**, collapse `planner`/`generate`/`reflect`/`revise`/`final` into one
  bounded loop: `todoListMiddleware` for planning-on-demand, `modelCallLimitMiddleware({
  exitBehavior: 'end' })` for the bound, `llmToolSelectorMiddleware` for tool count. Migrate chat
  first, then scheduled/gateway runs, keeping the old graph switchable until parity is measured.
- **P3-3 — Revisit `deepagents` only if** subagent isolation (isolated context windows per
  sub-task) becomes a real requirement. Do **not** adopt its `createFilesystemMiddleware` — it
  duplicates and conflicts with `workspace/workspace-file-service.ts`.

**Explicitly out of scope for P3:** the memory subsystem, skills synthesis, connectors/gateway,
workspace files, and the Prisma schema. None of them need to move, and moving them would be the
expensive, risky part.

---

## 7a. P3 spike results (2026-08-06)

Spike lives in `libs/claw-studio/src/agent/claw-agent.ts` with coverage in
`claw-agent.test.ts`. **Not wired into any production path.** Findings against the four
risks in P3-1:

| Risk | Result | Evidence |
|---|---|---|
| HITL survives on a checkpointer | ✅ **Retired** | approve runs the tool, reject doesn't, `autoApprove` never pauses — all resumed through a checkpointer via `new Command({ resume: { decisions: [...] } })` |
| Approval rules stay single-sourced | ✅ **Retired** | `buildInterruptOn()` derives `interruptOn` from the existing `classifyTool`; granted tools and `mode:'all'` both exempt correctly |
| Planning stops being mandatory | ✅ **Retired** | a trivial turn costs **1 model call and produces zero todos**, vs `plannerNode` forcing a minimum of one plan step |
| Stream shape fits the event layer | ❌ **BLOCKER FOUND** | see below |
| Tenant-scoped per-run tools | ✅ Mechanical | tools are already constructed per-run in `claw-runtime.ts` and passed straight in |

### The blocker: node names don't match

`createAgent` emits middleware-scoped node names, not the graph's:

```
updates:  ModelCallLimitMiddleware.before_model, model_request,
          HumanInTheLoopMiddleware.after_model, todoListMiddleware.after_model,
          ModelCallLimitMiddleware.after_agent
messages: model_request
```

Two downstream consumers key off node names and would break **silently**:

1. `execute-run.ts`'s `SILENT_NODES` (`memory_recall`/`memory_save`) matches nothing, so
   every middleware hook would surface as a visible timeline entry.
2. The chat route's `STREAMING_NODES` (`respond`/`final`) matches nothing, so **token
   streaming would emit no tokens at all** — silently reverting P2.

Neither throws; both just quietly do the wrong thing. A migration needs a
name-translation shim between the agent stream and the event layer. Cheap to write, but
it must exist and be tested — pinned by the `MIGRATION BLOCKER` test in
`claw-agent.test.ts`.

### Two API details that cost time

- `createAgent` requires `model`, not the `llm` alias the docstring mentions.
- It rejects duck-typed model stubs (`llm ... must define bindTools method`) where the
  hand-rolled graph accepted them — tests need a real `BaseChatModel` subclass.

### Recommended next step

Do **not** migrate the task path yet. The remaining work, in order: write the node-name
shim, run both paths against the same prompt set behind a flag, and compare answers and
call counts before switching anything. Also worth folding in regardless of migration:
`bedrockPromptCachingMiddleware` (installed, unused) for the Bedrock provider.

---

## 8. Success criteria

Measure before/after from `claw_run_events`, not by feel:

| Metric | Today | Target |
|---|---|---|
| LLM calls for `"hi"` | 5 | ≤ 2 |
| Wall time, conversational turn | 22–536s | < 5s |
| Time-to-first-token | = full pipeline | < 1.5s |
| Runs hitting `recursionLimit` | ≥ 1 observed | 0 |
| revise:generate ratio | 57:19 worst case | ≤ 1:2 |
| LLM calls, 1-tool task | ~12–15 | ≤ 6 |

Accuracy guardrail: a fixed prompt set (greetings, identity, single-tool lookup, multi-step Jira
task, ambiguous request) must produce answers **at least as correct** as today. Speed gained by
skipping work that was actually needed is a regression, not a win.

---

## 9. Open questions

1. Should `triage` eventually disappear entirely — i.e. let the ReAct model decide by simply not
   calling tools — trading one classification call for occasional mis-selection?
2. Is `final` still justified once `generate` streams, or should the generating node own the
   user-visible answer directly? (Its context-starvation bug was fixed in `61fdf14`, but it remains
   a whole extra call.)
3. Do scheduled/background runs want a different bound than chat (`BACKGROUND_MAX_ITERATIONS = 30`
   vs `MAX_ITERATIONS = 10`), or does planning-as-tool make both converge?
4. `memory_recall`/`memory_save` add LLM calls to *every* run, conversational ones included —
   should the chat path skip extraction entirely and defer it?
