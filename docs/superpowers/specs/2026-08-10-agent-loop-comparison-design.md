# Agent Loop Comparison — LangGraph vs DeepAgents

**Status:** Design (approved, pre-implementation)
**Date:** 2026-08-10
**Author:** Adya Tiwari + Claude
**Question being answered:** does Claw give more accurate replies at lower latency on the hand-written LangGraph `StateGraph`, or on the `createDeepAgent` loop that replaced it?

---

## 1. The two arms

| Arm | Where it lives | Loop |
|---|---|---|
| **A — `langgraph`** | branch `feature/claw-studio` | Hand-written `StateGraph`: planner → generate → evaluator → reflect → revise → final, with memory recall/save as graph nodes (`claw-graph.ts`, `claw-agent.ts`, `executor-state.ts`) |
| **B — `deepagents`** | this repo's **uncommitted working tree** | One `createDeepAgent` loop; planning is the `write_todos` tool, memory is middleware, workspace is a `BackendProtocolV2` (`claw-deep-agent.ts`, `memory-middleware.ts`, `workspace-backend.ts`) |

Two facts make this comparison unusually clean, and one makes it fragile.

**Clean:** `HEAD` of `feature/claw-runtime-improvements` differs from `feature/claw-studio` by exactly one file (`deepagents-contract.test.ts`, +60 lines). The whole loop rewrite is uncommitted working-tree change — 33 modified files (+1107/−2473) plus 16 untracked. So there is almost no unrelated branch drift to control for.

**Clean:** both arms expose an **identical** `ResolveClawRuntimeInput` — `tenantId`, `threadId`, `maxIterations`, `promptSurface`, `sourceRunId`, `approvalPolicy`, `overrides` (`systemPrompt`, `providerModelId`, `temperature`, `maxTokens`, `autoApprove`). Every variable can be pinned through the same interface on both sides. No adapter shims, no per-arm special cases.

**Fragile:** Arm B is uncommitted and is therefore **the only copy of that work**. Nothing in this design may check out another branch in the main working tree. Arm A runs in a `git worktree`, which leaves the main tree untouched.

### 1.1 What is deliberately excluded

The working tree bundles two independent changes. Only the first is under test:

1. The agent loop rewrite — **in scope**.
2. The browsing feature (`browser-*`, `web-tools`, `url-guard`) — **out of scope**, by the user's decision (it has not had basic manual testing yet) and independently required for validity: Arm A has no such tools, so leaving them enabled in Arm B would compare tool surfaces rather than loops.

---

## 2. Architecture

```
tools/agent-bench/
  questions/corpus.ts     fixed question set
  record.ts               zod schema for one run record
  bench-env.ts            bench tenant/claw provisioning + per-run reset
  runner.ts               drives one arm → JSONL
  scorers/
    completion.ts         deterministic assertions
    quality.ts            blind LLM judge
    efficiency.ts         model calls, tokens, redundant calls
    robustness.ts         variance across repeats
  report.ts               both arms' JSONL → paired comparison
  run-arm.sh              copy harness into a target tree, run it there
bench-results/<timestamp>/{langgraph,deepagents}.jsonl    gitignored
```

Standalone bun scripts, not Vitest: this is an experiment, it needs to run well past the 60s test timeout, and it must not join any lib's test graph.

### 2.1 The arm switch is the working directory

The harness imports `resolveClawRuntime` through the tree's own `tsconfig` path alias. Whichever tree it runs in decides which implementation it measures — no flags, no conditional imports, no way to accidentally measure the wrong arm.

- **Arm B:** run in the repo root as-is.
- **Arm A:** `git worktree add ../chatflow-langgraph feature/claw-studio`, then `run-arm.sh` rsyncs `tools/agent-bench/` into that tree and runs it there.

The rsync exists because the harness itself is uncommitted, so a fresh worktree would not contain it. Copying it in keeps a single source of truth for the harness while the *implementation under test* varies by tree.

### 2.2 Prerequisites

- PostgreSQL reachable at `DATABASE_URL`, with migrations applied via `prisma migrate deploy`.
- The Arm A worktree needs its own `bun install`.
- A working tenant `LlmProvider` row for the bench tenant. `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION` and `BEDROCK_CHAT_MODEL` are set in `.env`; `AWS_ACCESS_KEY_ID` is not, so Bedrock auth goes through the bearer token.
- `ENCRYPTION_KEY` set (provider credentials are stored encrypted).

---

## 3. Controls

Every variable below is pinned identically on both arms. This section is the experiment.

| Variable | How it is pinned | Why it matters |
|---|---|---|
| Iteration budget | `maxIterations` passed explicitly, same number both arms | Arm A hardcodes 10; Arm B reads `env.CLAW_MAX_ITERATIONS`, default 30. Unpinned, Arm B gets 3× the model calls and wins multi-step questions for a reason unrelated to DeepAgents. **The single biggest rigging risk.** |
| Model + provider | `overrides.providerModelId`, one bench `LlmProvider` row | Different models make the result meaningless |
| Sampling | `overrides.temperature: 0` | Reduces variance; fewer repeats needed for the same signal |
| Approvals | `overrides.autoApprove: true` | Otherwise every mutative tool call raises an interrupt and an unattended run deadlocks |
| Checkpoint state | fresh `threadId` per (question, repetition, arm) | Concurrent or reused threads overwrite each other's checkpoints |
| Long-term memory | truncate `claw_memories` for the bench claw between runs | Both arms save to and recall from pgvector. Without this, question *k* changes the agent that answers *k+1*, and run order differs between arms |
| Workspace files | reseed from templates before each run | Self-authored `user`/`tools`/`heartbeat` content would carry across runs |
| Prompt surface | `promptSurface: 'acting'` both arms | Different surfaces compose different system prompts |
| Tool surface | `CLAW_BROWSER_ENABLED=false`; no search provider configured for the bench tenant | §1.1 / §3.1 — reduces Arm B to Arm A's tool surface without editing browsing code |
| Tenant | dedicated bench tenant + claw, never a real one | The bench writes workspace files, memories, and whatever else a question asks for |

### 3.1 The tool surfaces cannot be equalized — and that reframes the claim

`createDeepAgent` force-installs `FilesystemMiddleware` and `SubAgentMiddleware` through its internal `REQUIRED_MIDDLEWARE_NAMES` set, with **no opt-out** (see `libs/claw-studio/CLAUDE.md`). Arm B therefore always carries tools Arm A does not have at all:

`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`, `start_async_task`, `check_async_task`, `update_async_task`, `cancel_async_task`, `list_async_tasks`, `task` — plus `write_todos`, added deliberately via `todoListMiddleware`.

That is roughly 14 extra tools. It is not removable, so **this experiment cannot isolate "the control loop" as an independent variable.** What it can measure honestly is the thing that actually matters for the product question: *the DeepAgents approach as it actually ships* versus *the hand-written graph as it actually shipped*. Loop topology and forced tooling are one bundle.

Two consequences:

- The report must include a **tool-surface diff** alongside the scores, so any difference is read against the fact that Arm B had more affordances available.
- A finding like "Arm B completes multi-step questions more often" may be attributable to `write_todos` and `task` rather than to the loop. The corpus therefore records which tools each run actually used, so that attribution can be examined rather than assumed.

The remaining browsing-related delta is negligible by comparison, and is handled with existing switches only:

- **The 10 `browser_*` tools** are removed by the existing `CLAW_BROWSER_ENABLED=false`.
- **`web_search`** is omitted automatically: `createWebTools` only registers it when a search provider resolves, and the bench tenant deliberately configures none.
- **`web_fetch`** registers unconditionally and has no kill switch. Adding one would mean editing `web-tools.ts` before it has had any manual testing, so it is left in place — one extra tool on top of the ~14 already unavoidable from §3.1. The runner records every tool call, so any run that actually invokes it is flagged in the report.

The corpus deliberately uses only capabilities **both** arms have — workspace files, memory, scheduled tasks, and plain conversation — so no question *requires* a tool that exists on one side only. Where Arm B solves something via `write_todos` or `task`, that shows up in its recorded tool sequence and is reported, not hidden.

### 3.2 Arms alternate in batches

Two arms cannot be interleaved inside one process, so all of A then all of B would load any provider-side latency drift (throttling, time-of-day capacity) onto whichever arm ran second. The driver therefore alternates in batches — A rep 1, B rep 1, A rep 2, B rep 2 — so drift is spread across both arms instead of being confused for a design difference.

---

## 4. What each run records

One JSONL record per (question, repetition, arm):

```ts
{
  arm: 'langgraph' | 'deepagents',
  questionId, repetition, startedAt,
  latency: { totalMs, timeToFirstTextMs },
  modelCalls, tokens: { input, output },
  toolCalls: [{ name, argsHash, ok, ms }],
  finalText, interrupts, budgetExhausted, error
}
```

Two fields need a uniform definition because the arms count differently:

**`modelCalls` is not read from either arm's own counter.** Arm B has `modelCallLimitMiddleware`'s `runModelCallCount`; Arm A has its own iteration counter in `executor-state`; these count different events. Instead the harness calls `graph.getState()` after the run and counts `AIMessage`s in `state.values.messages` — both arms are LangGraph underneath, so one definition applies identically to both. `tokens` sums `usage_metadata` off those same messages, which yields a cost axis at no extra cost.

**`timeToFirstTextMs` is graph-level, not per-token.** It is the elapsed time to the first stream chunk carrying assistant text. Stated explicitly because `libs/claw-studio/CLAUDE.md` records that token streaming through the `custom` stream mode is currently dead — a UI-level TTFT would measure that bug rather than the agent.

---

## 5. Scoring

**Completion** — deterministic, no judge. Per question: the required tool names appear in `toolCalls`, plus an optional DB assertion (the workspace row or scheduled task actually exists). Binary per run; reported as a rate.

**Quality** — LLM judge, and **blind**. Records are pooled, shuffled, the `arm` field stripped and ids anonymised before the judge sees anything. Rubric: correctness, completeness, relevance, each 1–5, against a reference answer, on a pinned judge model. Two independent passes; disagreements greater than one point are flagged for human review rather than silently averaged.

**Efficiency** — model calls, tool calls, redundant calls (same `name` + `argsHash` twice in one run), `budgetExhausted` rate, token totals.

**Robustness** — across repeats: completion rate, quality standard deviation, and a flakiness figure (the fraction of questions whose completion outcome varies between repeats).

### 5.1 Question corpus

A fixed set spanning the categories where the two designs should diverge:

- **Conversational** — single-turn questions needing no tools. Arm A's planner/evaluator/reflect topology should cost extra model calls here for no benefit.
- **Single-tool** — one obvious tool call (read a workspace file, search memory).
- **Multi-step** — several dependent tool calls (read a file, derive something, write it back). Where Arm A's reflect/revise cycle might genuinely help.
- **Ambiguous** — under-specified requests where the right behaviour is to ask rather than guess.
- **Refusal / no-op** — requests the agent should decline or recognise as already satisfied.

Each entry carries `id`, `prompt`, `category`, `expectedTools`, `referenceAnswer`, and optional `dbAssertions`.

---

## 6. Reporting

- Default **N = 5** repeats per question per arm.
- Latency as **median and p95**; quality as **mean ± stdev**.
- The comparison is **paired per question** — same question, both arms, examine the delta — not a comparison of global means, which is far less sensitive at this N.
- Results are broken down **by category**. A single blended number would hide the most likely real finding, which is that the two loops differ in opposite directions on trivial versus multi-step turns.
- The report prints **"inconclusive"** where paired deltas straddle zero. With N=5 and a nondeterministic agent this is a likely and legitimate outcome for at least some categories, and is a more useful output than a spurious winner.
- Failure modes are reported qualitatively too: a table of runs that errored or exhausted their budget, which is often more informative than the aggregate scores.

### 6.1 Built-in validity check

Before any scoring, the harness runs one control question on both arms and **diffs the composed system prompt**. If the arms do not send the model the same prompt, every downstream number is confounded. The check is cheap and mechanical, and it answers up front whether this experiment is comparing loops or comparing prompts.

---

## 7. Threats to validity

Stated plainly, because the result is only as good as these:

- **N=5, one machine, one provider.** This is a directional signal, not a benchmark publication. Batch alternation spreads provider drift but does not eliminate it.
- **The tool surface differs by ~14 tools and cannot be equalized** (§3.1). This is the largest threat to any "the loop is better" claim, and the reason the report pairs every score with a tool-surface diff.
- **The memory subsystem differs by design.** Arm A runs recall/save as graph nodes; Arm B as middleware. That is part of the loop rewrite and legitimately in scope, but it means "the loop" includes "how memory is wired", not just the control flow.
- **`temperature: 0` reduces but does not remove nondeterminism** — tool-choice ordering can still vary.
- **The judge is an LLM.** Blinding and two passes mitigate bias; they do not remove it. Any headline quality claim should be spot-checked by reading a handful of transcripts.
- **Completion assertions encode an opinion** about which tools *should* be called. A run that reaches a correct answer by an unexpected route scores as a failure. The per-question tool lists should be reviewed as a rubric, not treated as ground truth.

---

## 8. Out of scope

- Any change to the browsing feature (§1.1).
- Comparing the HTTP/SSE layer or UI streaming — the harness drives the graph directly.
- Committing anything. No commits without an explicit request.
