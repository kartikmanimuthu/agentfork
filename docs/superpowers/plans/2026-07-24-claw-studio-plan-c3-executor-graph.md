# Claw Studio — Plan C3: Executor Graph (clone of nucleus Agent Ops)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the C1 single-node stub graph with a **faithful clone of nucleus-cloud-ops' Agent Ops executor graph** — the full `memory_recall → evaluator → planner → [approval_gate] → generate ⇄ tools ⇄ reflect → revise → final → memory_save` topology, its tool-classification-driven HITL (plan-level + per-batch mutative-tool approval), and its reflection-stall hardening — wired to this repo's `ClawConversation` (thread persistence), `Claw.autoApprove` (HITL on/off), and the C2 memory nodes (already built, currently unused). This is the single most important increment in the Claw Studio roadmap: every later phase (skills, MCP, scheduled tasks, connectors) plugs into the graph this plan builds.

**Source of truth:** `/Users/H2952/Documents/nucleus-cloud-ops` @ `master-v1`, paths under `apps/web-ui/lib/agent-ops/` and `apps/web-ui/lib/agent/`. **Read the CURRENT source for every ported file before writing the adapted version** — do not transcribe from memory or from this plan's prose summaries alone; the repo is a live reference and its node wiring, guard-router logic, and prompt strings are the ground truth. This plan's code blocks are a faithful, well-researched starting point, not a substitute for reading the source.

## Architecture

`libs/claw-studio/src/agent/claw-graph.ts` is rewritten from a 1-node stub into the full topology below. New supporting modules (`executor-state.ts`, `tool-classifier.ts`, `prompt-templates.ts`, `run-manager.ts`, `memory-tools.ts`) are ported/adapted from nucleus's Agent Ops. `claw-runtime.ts` is rewritten to resolve the tenant's `Claw` row, get-or-create its `ClawConversation` thread, and compile the graph with the Postgres checkpointer + memory store (both already built in Plan C2) and `interruptBefore` gated by `Claw.autoApprove`. Mission Control's `/api/chat` route is rewritten to persist conversation turns by thread, detect a paused (interrupted) run, and resume it from a follow-up request. The chat UI gets a minimal approval banner and a stop-generating control.

```
                         ┌─────────────────────────────────────────────────────┐
START → memory_recall → evaluator ─(mode:end)→ clarify ──────────────────────→ END
                            │
                            └─(mode:plan)→ planner ─(requiresApproval)→ approval_gate → END
                                              │                                (interruptBefore)
                                              └─(else)→ generate ⇄ tools ⇄ reflect → revise
                                                          │            │(re-enters generate/revise)
                                                          │            └(mutative call)→ mutative_approval_gate → END
                                                          │                              (interruptBefore)
                                                          └──────────────→ final → memory_save → END
```

**Domain-agnostic clone, not a re-theming.** Nucleus's graph shape, tool-classification approach, and HITL mechanics are generic — they were never AWS-specific at the architecture level, only in prompt *copy* and in the AWS-flavored allowlist entries. This plan clones the mechanism exactly (node responsibilities, routing conditions, interrupt points, stall detection, resume semantics) and adapts only the persona/identity text (Claw, not "AWS DevOps Agent") and drops the two nucleus concepts Claw Studio doesn't have yet: **Accounts** (no AWS account context) and **Knowledge Base auto-select** (no KB in this repo). Skill selection in the evaluator is **stubbed** (`skillId: null` always) exactly the way C2 stubbed skill synthesis — C4 wires it for real. The tool-classifier's generic mutative patterns (create/update/delete/deploy/`rm -rf`/`git push`/etc.) are kept verbatim since they apply to whatever tools eventually get bound (MCP tools in C5) regardless of domain.

**Tech Stack:** `@langchain/langgraph` (`Annotation.Root`, `interruptBefore`, `updateState`), `@langchain/core`, existing `@chatbot/claw-studio` memory/persistence exports from Plan C2, Zod, Pino, T3 Env.

## Global Constraints

- **Read the CURRENT nucleus source** for `executor-graphs.ts`, `executor-state.ts`, `tool-classifier.ts`, `run-manager.ts`, and `prompt-templates.ts` before porting each — the repo is actively developed; match its current logic and adapt only the documented bridges.
- **Bridges (the only intended changes):** the Claw's identity flows into memory nodes as `userId` = `claw.id` (unchanged from C2's convention); thread persistence uses `ClawConversation.threadId` (LangGraph's `configurable.thread_id`) instead of nucleus's `AgentOpsRun`/`agent_ops_events` rows; `autoApprove` comes from the `Claw` row, not a run-level flag; no `Account`/AWS-STS context; no Knowledge Base auto-select; skill selection is a stub (`skillId: null`) until Plan C4.
- **One conversation per Claw for now.** `ClawConversation` supports multiple threads, but Phase 1 keeps it simple: `claw-runtime.ts` gets-or-creates a single conversation row per Claw. A thread switcher/multi-conversation UI is out of scope here (matches the "one Claw" gating pattern already used for Studio/Claw multiplicity).
- **No AWS/Accounts/KB fields survive into the ported state or prompts.** Where nucleus's `RequestEvaluation` also carries `accountId`/`knowledgeBaseIds`, this port's `RequestEvaluation` carries only `mode`, `requiresApproval`, `clarificationQuestion`, and a stubbed `skillId: null`.
- **Standards:** typed params (no implicit `any`); try/catch + Pino (`createLogger`) in every node and route; Zod at the chat route's request boundary; fail-open behavior preserved everywhere nucleus has it (embedding failures, reflection/evaluation JSON-parse failures, memory-store failures never abort a turn).
- **Existing C1/C2 tests may need rewriting, not just extending.** `claw-graph.test.ts`'s two existing tests were written against the single-node stub; replacing the graph topology legitimately changes what they assert. Task 6 replaces them with tests against the real graph — this is an intentional, expected replacement, not a regression.
- **Verify against the installed LangGraph version.** `interruptBefore`, `updateState`, and the `Annotation.Root` API shape must be checked against the version actually installed (`@langchain/langgraph` in root `package.json`) — if a signature differs from this plan's code, adjust and note the deviation in the commit, matching the hedge already used in Plan C1 Task 4.

---

### Task 1: Executor state — the real LangGraph state channels

**Files:**
- Create: `libs/claw-studio/src/agent/executor-state.ts`
- Test: `libs/claw-studio/src/agent/executor-state.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces: `ClawGraphAnnotation` (a LangGraph `Annotation.Root`), `type ClawGraphState = typeof ClawGraphAnnotation.State`, `RequestEvaluation` type. Structurally compatible with `MemoryNodeState` from `memory/types.ts` (same field names/shapes for `messages`, `taskDescription`, `plan`, `toolResults`, `errors`, `reflection`, `iterationCount`, `isComplete`, `memoryContext`, `memoryStats`), so C2's `createMemoryRecallNode`/`createMemorySaveNode` type-check against it without modification.

- [ ] **Step 1: Read the nucleus source**

Read `apps/web-ui/lib/agent-ops/executor-state.ts` in nucleus-cloud-ops. Note the channel list, the messages-cap-to-100 reducer, the `toolResults` accumulate-never-truncate reducer, and the comment explaining why `reflectionStallCount` needed its own channel (LangGraph drops any state key without a registered reducer).

- [ ] **Step 2: Write the failing test**

Create `libs/claw-studio/src/agent/executor-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ClawGraphAnnotation } from './executor-state';

describe('ClawGraphAnnotation', () => {
  it('provides sane defaults for every channel', () => {
    const state = ClawGraphAnnotation.spec;
    expect(typeof state).toBe('object');
  });

  it('caps messages to the last 100 via its reducer', () => {
    const channel = ClawGraphAnnotation.spec.messages;
    const many = Array.from({ length: 105 }, (_, i) => new HumanMessage(`msg-${i}`));
    const result = channel.reducer!([], many);
    expect(result.length).toBe(100);
    expect(String(result[result.length - 1].content)).toBe('msg-104');
  });

  it('accumulates toolResults across updates rather than replacing', () => {
    const channel = ClawGraphAnnotation.spec.toolResults;
    const afterFirst = channel.reducer!([], [{ toolName: 'a', output: '1', isError: false, iterationIndex: 0 }]);
    const afterSecond = channel.reducer!(afterFirst, [{ toolName: 'b', output: '2', isError: false, iterationIndex: 1 }]);
    expect(afterSecond).toHaveLength(2);
  });

  it('replaces plan/evaluation on write rather than merging', () => {
    const channel = ClawGraphAnnotation.spec.evaluation;
    const first = channel.reducer!(null, { mode: 'plan', requiresApproval: false, skillId: null });
    const second = channel.reducer!(first, { mode: 'end', requiresApproval: false, skillId: null, clarificationQuestion: 'which account?' });
    expect(second.mode).toBe('end');
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/executor-state.test.ts`
Expected: FAIL — cannot find `./executor-state`.

- [ ] **Step 4: Implement**

Create `libs/claw-studio/src/agent/executor-state.ts`:

```ts
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { MemoryStats } from '../memory/types';

export interface PlanStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ToolResultEntry {
  toolName: string;
  output: string;
  isError: boolean;
  iterationIndex: number;
}

/**
 * The evaluator's classification of an incoming turn. Mirrors nucleus'
 * RequestEvaluation minus `accountId`/`knowledgeBaseIds` (no Accounts/KB
 * concept here). `skillId` is carried now but always resolves to `null` —
 * Plan C4 wires real skill selection.
 */
export interface RequestEvaluation {
  mode: 'plan' | 'end';
  requiresApproval: boolean;
  skillId: string | null;
  clarificationQuestion?: string;
}

const MAX_MESSAGES = 100;

// Wrap MessagesAnnotation's own reducer (message-id-aware merge/dedup) and cap
// the result — mirrors nucleus' "messages capped to last 100" channel exactly.
const cappedMessages = Annotation<BaseMessage[]>({
  reducer: (current, update) => {
    const merged = MessagesAnnotation.spec.messages.reducer(current, update as never);
    return merged.length > MAX_MESSAGES ? merged.slice(merged.length - MAX_MESSAGES) : merged;
  },
  default: () => [],
});

export const ClawGraphAnnotation = Annotation.Root({
  messages: cappedMessages,
  taskDescription: Annotation<string>({ reducer: (_prev, next) => next, default: () => '' }),
  plan: Annotation<PlanStep[]>({ reducer: (_prev, next) => next, default: () => [] }),
  // Accumulates — never truncated by the reducer (matches nucleus: the full
  // tool-result history is preserved for `final`'s summarization).
  errors: Annotation<string[]>({ reducer: (prev, next) => [...prev, ...next], default: () => [] }),
  reflection: Annotation<string>({ reducer: (_prev, next) => next, default: () => '' }),
  iterationCount: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  nextAction: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  isComplete: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  toolResults: Annotation<ToolResultEntry[]>({ reducer: (prev, next) => [...prev, ...next], default: () => [] }),
  memoryContext: Annotation<string>({ reducer: (_prev, next) => next, default: () => '' }),
  memoryStats: Annotation<MemoryStats | null>({ reducer: (_prev, next) => next, default: () => null }),
  evaluation: Annotation<RequestEvaluation | null>({ reducer: (_prev, next) => next, default: () => null }),
  clarificationQuestion: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  approvalStatus: Annotation<'pending' | 'approved' | 'rejected' | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  pendingToolApprovals: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  // Its own channel — a state key with no registered reducer/channel is
  // silently dropped by LangGraph (the bug class nucleus' own comment flags).
  reflectionStallCount: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
});

export type ClawGraphState = typeof ClawGraphAnnotation.State;
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { ClawGraphAnnotation } from './agent/executor-state';
export type { ClawGraphState, PlanStep, ToolResultEntry, RequestEvaluation } from './agent/executor-state';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/executor-state.test.ts` → PASS (4 tests).
Run: `bunx nx typecheck claw-studio` → no errors.

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): executor graph state channels (ported from Agent Ops)"
```

---

### Task 2: Tool classifier — read-only vs. mutative

**Files:**
- Create: `libs/claw-studio/src/agent/tool-classifier.ts`
- Test: `libs/claw-studio/src/agent/tool-classifier.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces: `classifyTool(toolCall: { name: string; args: Record<string, unknown> }): { isMutative: boolean; matchedRule: boolean }`, `filterMutativeToolCalls(toolCalls: ToolCall[]): ToolCall[]`.

- [ ] **Step 1:** Read `apps/web-ui/lib/agent/tool-classifier.ts` in nucleus. Note the three tiers in priority order: (1) explicit read-only allowlist wins over any pattern match, (2) bash/shell special-casing that inspects `command`/`cmd`/`input` args against mutating-verb patterns and fails **closed** (unrecognized bash content → flagged, not assumed safe) when it can't find a recognized arg key, (3) generic mutative name-pattern regex. Port the allowlist/pattern **categories** verbatim (the generic ones — create/update/delete/start/stop/deploy/scale/grant/revoke/execute/publish/write_file/`rm -rf`/`chmod`/`chown`/`sudo`/`git push`/`kubectl apply|delete`/`terraform apply|destroy`/`curl -X POST|PUT|PATCH|DELETE`/package installs) — these are domain-agnostic and will classify whatever MCP tools Plan C5 binds.

- [ ] **Step 2: Write the failing test**

Create `libs/claw-studio/src/agent/tool-classifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyTool, filterMutativeToolCalls } from './tool-classifier';

describe('classifyTool', () => {
  it('treats explicit read-only allowlist entries as safe even if name-like a mutation', () => {
    expect(classifyTool({ name: 'list_resources', args: {} }).isMutative).toBe(false);
    expect(classifyTool({ name: 'get_status', args: {} }).isMutative).toBe(false);
    expect(classifyTool({ name: 'search_memory', args: {} }).isMutative).toBe(false);
    expect(classifyTool({ name: 'read_file', args: {} }).isMutative).toBe(false);
  });

  it('flags generic mutative verb patterns', () => {
    expect(classifyTool({ name: 'create_resource', args: {} }).isMutative).toBe(true);
    expect(classifyTool({ name: 'delete_record', args: {} }).isMutative).toBe(true);
    expect(classifyTool({ name: 'deploy_service', args: {} }).isMutative).toBe(true);
    expect(classifyTool({ name: 'save_memory', args: {} }).isMutative).toBe(false); // bookkeeping, allowlisted
  });

  it('inspects bash-like tool args for mutating shell commands', () => {
    expect(classifyTool({ name: 'bash', args: { command: 'ls -la' } }).isMutative).toBe(false);
    expect(classifyTool({ name: 'bash', args: { command: 'rm -rf /tmp/x' } }).isMutative).toBe(true);
    expect(classifyTool({ name: 'bash', args: { command: 'git push origin main' } }).isMutative).toBe(true);
    expect(classifyTool({ name: 'bash', args: { command: 'curl -X POST https://x' } }).isMutative).toBe(true);
  });

  it('fails closed for bash-like calls with no recognized arg key', () => {
    const result = classifyTool({ name: 'bash', args: { weirdKey: 'rm -rf /' } });
    expect(result.matchedRule).toBe(false);
  });

  it('filters a mixed batch down to only the mutative calls', () => {
    const calls = [
      { name: 'list_resources', args: {} },
      { name: 'delete_record', args: {} },
      { name: 'search_memory', args: {} },
    ];
    const mutative = filterMutativeToolCalls(calls);
    expect(mutative.map((c) => c.name)).toEqual(['delete_record']);
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/tool-classifier.test.ts`
Expected: FAIL — cannot find `./tool-classifier`.

- [ ] **Step 4: Implement** (port nucleus's categories; adjust names/comments only)

Create `libs/claw-studio/src/agent/tool-classifier.ts`:

```ts
/**
 * tool-classifier.ts
 *
 * Deterministic, regex-based tool-call risk classifier — ported from nucleus
 * Agent Ops' tool-classifier.ts. Three tiers, checked in order:
 *   1. Explicit read-only allowlist — wins over any pattern match below.
 *   2. Bash/shell special-casing — inspects command-like args for mutating
 *      shell verbs; FAILS CLOSED (flagged, not assumed safe) if no recognized
 *      arg key is found on a bash-like call.
 *   3. Generic mutative name-pattern match.
 * Unmatched names default to non-mutative with matchedRule:false.
 */

export interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolClassification {
  isMutative: boolean;
  matchedRule: boolean;
}

const READ_ONLY_ALLOWLIST = new Set([
  'list_resources', 'list_conversations', 'list_skills', 'list_mcp_servers',
  'get_status', 'get_resource', 'get_config', 'get_aws_credentials',
  'read_file', 'search_memory', 'save_memory', 'load_skill',
  'search_knowledge_base', 'ask_user',
]);

const READ_ONLY_NAME_PREFIXES = ['describe_', 'list_', 'get_', 'read_', 'search_', 'fetch_', 'query_'];

const MUTATIVE_PATTERNS: RegExp[] = [
  /^create_/i, /^update_/i, /^delete_/i, /^remove_/i, /^start_/i, /^stop_/i,
  /^deploy_/i, /^scale_/i, /^grant_/i, /^revoke_/i, /^execute_/i, /^publish_/i,
  /^write_file/i, /^apply_/i, /^destroy_/i, /^terminate_/i, /^restart_/i,
  /^modify_/i, /^set_/i, /^enable_/i, /^disable_/i,
];

const MUTATIVE_BASH_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i, /\bchmod\b/i, /\bchown\b/i, /\bsudo\b/i,
  /\bkubectl\s+(apply|delete|scale|patch|rollout)\b/i,
  /\bterraform\s+(apply|destroy)\b/i,
  /\bgit\s+(push|commit|merge|rebase)\b/i,
  /\bnpm\s+(install|uninstall)\b|\byarn\s+add\b|\bbun\s+(add|remove)\b/i,
  /\bcurl\b.*-X\s*(POST|PUT|PATCH|DELETE)/i,
];

const BASH_ARG_KEYS = ['command', 'cmd', 'input', 'script'];

function isBashLike(name: string): boolean {
  return /^(bash|shell|exec|run_command)$/i.test(name);
}

function classifyBash(args: Record<string, unknown>): ToolClassification {
  for (const key of BASH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === 'string') {
      const isMutative = MUTATIVE_BASH_PATTERNS.some((re) => re.test(value));
      return { isMutative, matchedRule: true };
    }
  }
  // No recognized arg key — fail CLOSED: flag for adjudication rather than
  // silently trusting it's read-only.
  return { isMutative: true, matchedRule: false };
}

export function classifyTool(toolCall: ToolCallLike): ToolClassification {
  const name = toolCall.name;

  if (READ_ONLY_ALLOWLIST.has(name)) {
    return { isMutative: false, matchedRule: true };
  }
  if (READ_ONLY_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return { isMutative: false, matchedRule: true };
  }
  if (isBashLike(name)) {
    return classifyBash(toolCall.args ?? {});
  }
  if (MUTATIVE_PATTERNS.some((re) => re.test(name))) {
    return { isMutative: true, matchedRule: true };
  }
  return { isMutative: false, matchedRule: false };
}

export function filterMutativeToolCalls<T extends ToolCallLike>(toolCalls: T[]): T[] {
  return toolCalls.filter((call) => classifyTool(call).isMutative);
}
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { classifyTool, filterMutativeToolCalls } from './agent/tool-classifier';
export type { ToolCallLike, ToolClassification } from './agent/tool-classifier';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/tool-classifier.test.ts` → PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): tool-classifier (read-only vs mutative) ported from Agent Ops"
```

---

### Task 3: Prompt templates — evaluator / planner / generate / reflect / revise / final

**Files:**
- Create: `libs/claw-studio/src/agent/prompt-templates.ts`
- Test: `libs/claw-studio/src/agent/prompt-templates.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces builder functions consumed by Task 6's graph nodes: `buildIdentityPrompt(systemPrompt?: string)`, `buildEvaluatorPrompt()`, `buildPlannerPrompt()`, `buildGenerateSystemPrompt(deps: { identity: string; memoryContext: string; plan: PlanStep[]; mutationInstruction: string })`, `buildReflectPrompt()`, `buildRevisePrompt(deps: { analysis: string; issues: string[] })`, `buildFinalPrompt()`, `buildMutationInstruction(deps: { requiresApproval: boolean; autoApprove: boolean })`.

- [ ] **Step 1:** Read `apps/web-ui/lib/agent/prompt-templates.ts` in nucleus. Note: the evaluator's JSON output contract (`mode`, `requiresApproval`, `clarificationQuestion`, plus account/KB/skill fields this port drops or stubs), the planner's 3-phase methodology (Discovery / Analysis / Action & Verification — this structure is domain-agnostic and is kept), the reflect prompt's principal-engineer critique framing and `isComplete`/`updatedPlan`/`issues` JSON contract, the revise prompt's "fix only identified issues, don't redo completed steps" constraint, and the final prompt's structured "What Was Accomplished / Key Findings / Errors / Next Steps" delivery format. Port the **contracts and structure** verbatim; adapt only the persona line ("You are Claw, an autonomous teammate" instead of an AWS DevOps agent) and drop AWS-specific example phrasing.

- [ ] **Step 2: Write the failing test**

Create `libs/claw-studio/src/agent/prompt-templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildIdentityPrompt, buildEvaluatorPrompt, buildPlannerPrompt,
  buildGenerateSystemPrompt, buildReflectPrompt, buildRevisePrompt,
  buildFinalPrompt, buildMutationInstruction,
} from './prompt-templates';

describe('prompt-templates', () => {
  it('identity prompt includes a custom system prompt when provided', () => {
    expect(buildIdentityPrompt('You specialize in billing questions.')).toContain('You specialize in billing questions.');
  });

  it('identity prompt falls back to a default persona when none is provided', () => {
    expect(buildIdentityPrompt(undefined)).toMatch(/Claw/);
  });

  it('evaluator prompt requires a JSON object with mode/requiresApproval/skillId', () => {
    const prompt = buildEvaluatorPrompt();
    expect(prompt).toMatch(/"mode"/);
    expect(prompt).toMatch(/"requiresApproval"/);
    expect(prompt).toMatch(/"skillId"/);
  });

  it('planner prompt requires a JSON array of plan steps', () => {
    expect(buildPlannerPrompt()).toMatch(/JSON array/i);
  });

  it('generate system prompt composes identity, memory, plan, and mutation instruction', () => {
    const prompt = buildGenerateSystemPrompt({
      identity: 'IDENTITY_MARK', memoryContext: 'MEMORY_MARK',
      plan: [{ step: 'Do the thing', status: 'in_progress' }],
      mutationInstruction: 'MUTATION_MARK',
    });
    expect(prompt).toContain('IDENTITY_MARK');
    expect(prompt).toContain('MEMORY_MARK');
    expect(prompt).toContain('Do the thing');
    expect(prompt).toContain('MUTATION_MARK');
  });

  it('mutation instruction is stricter when approval is required and auto-approve is off', () => {
    const strict = buildMutationInstruction({ requiresApproval: true, autoApprove: false });
    const relaxed = buildMutationInstruction({ requiresApproval: false, autoApprove: true });
    expect(strict).toMatch(/approval/i);
    expect(relaxed).not.toMatch(/pause|approval required/i);
  });

  it('reflect prompt requires isComplete/issues/updatedPlan', () => {
    const prompt = buildReflectPrompt();
    expect(prompt).toMatch(/isComplete/);
    expect(prompt).toMatch(/issues/);
  });

  it('revise prompt scopes the fix to the reflector-identified issues only', () => {
    const prompt = buildRevisePrompt({ analysis: 'ANALYSIS_MARK', issues: ['issue one'] });
    expect(prompt).toContain('ANALYSIS_MARK');
    expect(prompt).toContain('issue one');
    expect(prompt).toMatch(/only.*identified issues|do not redo/i);
  });

  it('final prompt requires the structured delivery sections', () => {
    const prompt = buildFinalPrompt();
    expect(prompt).toMatch(/What Was Accomplished/);
    expect(prompt).toMatch(/Next Steps/);
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/prompt-templates.test.ts`
Expected: FAIL — cannot find `./prompt-templates`.

- [ ] **Step 4: Implement**

Create `libs/claw-studio/src/agent/prompt-templates.ts`:

```ts
/**
 * prompt-templates.ts
 *
 * Adapted from nucleus Agent Ops' prompt-templates.ts: same node responsibilities,
 * same JSON output contracts, same 3-phase planning methodology, same reflection
 * critique framing. Adapted: persona is Claw (a persistent teammate), not an AWS
 * DevOps agent; no Account/Knowledge-Base context; `skillId` is always requested
 * in the evaluator contract but resolves to null until Plan C4.
 */

import type { PlanStep } from './executor-state';

const DEFAULT_PERSONA = `You are Claw, a persistent autonomous teammate operating inside Mission Control. You accumulate memory across every conversation with this Studio and use it to get better at helping this specific team over time.`;

export function buildIdentityPrompt(systemPrompt?: string): string {
  return systemPrompt ? `${DEFAULT_PERSONA}\n\n${systemPrompt}` : DEFAULT_PERSONA;
}

export function buildEvaluatorPrompt(): string {
  return `You are the request evaluator for Claw. Classify the user's latest message.

Return ONLY a JSON object with this exact shape:
{
  "mode": "plan" | "end",
  "requiresApproval": boolean,
  "skillId": null,
  "clarificationQuestion": "string, only present when mode is \\"end\\" and you need more information before proceeding"
}

- "mode": "end" means you need to ask a clarifying question before any work can start (e.g. the request is ambiguous or missing required information). "plan" means proceed to planning.
- "requiresApproval": true if the task, on its face, looks like it will need to change something (not just answer a question) — the planner and tool-classifier will refine this per tool-call, this is a coarse first signal.
- "skillId": always null for now (skill selection is not yet wired).
- Only include "clarificationQuestion" when mode is "end".`;
}

export function buildPlannerPrompt(): string {
  return `You are the planner for Claw. Produce a step-by-step plan for the user's task using this methodology:

- Phase 1 (Discovery): what do you need to find out or look up before acting?
- Phase 2 (Analysis): what do you need to reason about once you have the facts?
- Phase 3 (Action & Verification): what will you actually do, and how will you confirm it worked?

Return ONLY a JSON array of plan steps, each shaped as:
{ "step": "one imperative sentence describing the step", "status": "pending" }

Keep the plan tight — 3 to 7 steps for most tasks. Trivial tasks (a direct question with no tool use needed) may return a single step.`;
}

export function buildMutationInstruction(deps: { requiresApproval: boolean; autoApprove: boolean }): string {
  if (deps.autoApprove) {
    return `Auto-approve is ON for this Claw. You may call mutative tools directly without pausing for approval — but still explain what you're about to change and why before doing it.`;
  }
  if (deps.requiresApproval) {
    return `This task was flagged as likely to need changes. Any mutative tool call will pause for the user's approval before it executes — plan your tool calls so a human reviewing the pending batch can tell exactly what will change.`;
  }
  return `Prefer read-only tools where they answer the question. If you do need a mutative tool, it will pause for approval before executing — that's expected, not an error.`;
}

export function buildGenerateSystemPrompt(deps: {
  identity: string;
  memoryContext: string;
  plan: PlanStep[];
  mutationInstruction: string;
}): string {
  const planText = deps.plan.length
    ? deps.plan.map((p, i) => `${i + 1}. [${p.status}] ${p.step}`).join('\n')
    : '(no plan — trivial task)';
  const memorySection = deps.memoryContext ? `\n\n## What you remember\n${deps.memoryContext}` : '';
  return `${deps.identity}${memorySection}

## Current plan
${planText}

## Mutation policy
${deps.mutationInstruction}

Work the current plan step. Use tools when they help; otherwise respond directly.`;
}

export function buildReflectPrompt(): string {
  return `You are reviewing Claw's own work so far, acting as a principal engineer critiquing correctness, completeness, and safety.

Return ONLY a JSON object:
{
  "isComplete": boolean,
  "issues": ["short description of each unresolved problem, empty array if none"],
  "updatedPlan": [{ "step": "...", "status": "pending" | "in_progress" | "completed" | "failed" }]
}

Be specific about issues — vague feedback ("could be better") is not actionable and will be treated as no feedback.`;
}

export function buildRevisePrompt(deps: { analysis: string; issues: string[] }): string {
  const issuesList = deps.issues.map((i) => `- ${i}`).join('\n');
  return `The reviewer found the following unresolved issues in your last attempt:

${issuesList || '(no specific issues listed)'}

Reviewer's analysis: ${deps.analysis}

Fix ONLY the identified issues. Do not redo steps the reviewer already confirmed are complete — that wastes iterations and risks re-breaking working parts of the task.`;
}

export function buildFinalPrompt(): string {
  return `Summarize this completed session for the user as a concise delivery note with exactly these sections, in this order:

## What Was Accomplished
## Key Findings
## Errors
## Next Steps

Use "None." under a section if it has nothing to report. Be concrete — reference what was actually done, not what was planned.`;
}
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export {
  buildIdentityPrompt, buildEvaluatorPrompt, buildPlannerPrompt,
  buildGenerateSystemPrompt, buildMutationInstruction, buildReflectPrompt,
  buildRevisePrompt, buildFinalPrompt,
} from './agent/prompt-templates';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/prompt-templates.test.ts` → PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): prompt templates for evaluator/planner/generate/reflect/revise/final"
```

---

### Task 4: Run manager — cancellation registry

**Files:**
- Create: `libs/claw-studio/src/agent/run-manager.ts`
- Test: `libs/claw-studio/src/agent/run-manager.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces: `registerRun(threadId): AbortController`, `cancelRun(threadId): boolean`, `isAborted(threadId): boolean`, `cleanupRun(threadId): void`. Enables a "Stop" button in Mission Control's chat (Task 9).

- [ ] **Step 1:** Read `apps/web-ui/lib/agent-ops/run-manager.ts` in nucleus. It's a minimal in-process `Map<runId, AbortController>` — no persistence, no cross-replica awareness (nucleus compensates for that with DB status polling during streaming, which does not apply here since Mission Control's chat is a single synchronous request/response per turn, not a long-lived async run). Port the registry as-is, keyed by `threadId` instead of `runId`.

- [ ] **Step 2: Write the failing test**

Create `libs/claw-studio/src/agent/run-manager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { registerRun, cancelRun, isAborted, cleanupRun } from './run-manager';

describe('run-manager', () => {
  it('registers a run and reports it as not aborted', () => {
    const controller = registerRun('thread-1');
    expect(controller).toBeInstanceOf(AbortController);
    expect(isAborted('thread-1')).toBe(false);
    cleanupRun('thread-1');
  });

  it('cancels a registered run and reports it as aborted', () => {
    registerRun('thread-2');
    expect(cancelRun('thread-2')).toBe(true);
    expect(isAborted('thread-2')).toBe(true);
    cleanupRun('thread-2');
  });

  it('returns false cancelling an unregistered run', () => {
    expect(cancelRun('nonexistent')).toBe(false);
  });

  it('cleanup removes the registration so a stale abort no longer reports true', () => {
    registerRun('thread-3');
    cancelRun('thread-3');
    cleanupRun('thread-3');
    expect(isAborted('thread-3')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/run-manager.test.ts`
Expected: FAIL — cannot find `./run-manager`.

- [ ] **Step 4: Implement**

Create `libs/claw-studio/src/agent/run-manager.ts`:

```ts
/**
 * run-manager.ts — in-process cancellation registry, ported from nucleus
 * Agent Ops' run-manager.ts, keyed by threadId instead of runId.
 *
 * Mission Control's chat is a single request/response per turn (not a
 * long-lived async run polled across replicas like nucleus' Agent Ops), so
 * the cross-replica DB-polling compensation nucleus needs does not apply
 * here — this registry alone is sufficient to let a user abort an in-flight
 * streaming reply from the same request.
 */

const registry = new Map<string, AbortController>();

export function registerRun(threadId: string): AbortController {
  const controller = new AbortController();
  registry.set(threadId, controller);
  return controller;
}

export function cancelRun(threadId: string): boolean {
  const controller = registry.get(threadId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isAborted(threadId: string): boolean {
  return registry.get(threadId)?.signal.aborted ?? false;
}

export function cleanupRun(threadId: string): void {
  registry.delete(threadId);
}
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { registerRun, cancelRun, isAborted, cleanupRun } from './agent/run-manager';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/run-manager.test.ts` → PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): run-manager cancellation registry ported from Agent Ops"
```

---

### Task 5: Memory tools — `search_memory` / `save_memory` bound into the graph

**Files:**
- Create: `libs/claw-studio/src/agent/memory-tools.ts`
- Test: `libs/claw-studio/src/agent/memory-tools.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces: `createMemoryTools(deps: { tenantId: string; userId: string }): StructuredToolInterface[]` — two LangChain tools (`search_memory`, `save_memory`) wired to Plan C2's `searchMemory`/`saveMemory` (`agent/persistence.ts`). This is the minimal tool surface `generate` binds until Plan C4 (skill loader tool) and Plan C5 (MCP tools) add more.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/agent/memory-tools.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./persistence', () => ({
  searchMemory: vi.fn(async () => [{ key: 'k', value: { fact: 'test fact' }, namespace: 'ns' }]),
  saveMemory: vi.fn(async () => undefined),
}));

import { createMemoryTools } from './memory-tools';

describe('createMemoryTools', () => {
  it('creates exactly search_memory and save_memory tools', () => {
    const tools = createMemoryTools({ tenantId: 't1', userId: 'u1' });
    expect(tools.map((t) => t.name).sort()).toEqual(['save_memory', 'search_memory']);
  });

  it('search_memory returns matches as a string the model can read', async () => {
    const tools = createMemoryTools({ tenantId: 't1', userId: 'u1' });
    const search = tools.find((t) => t.name === 'search_memory')!;
    const result = await search.invoke({ query: 'test', namespacePrefix: 'ns' } as never);
    expect(String(result)).toContain('test fact');
  });

  it('save_memory persists and confirms', async () => {
    const tools = createMemoryTools({ tenantId: 't1', userId: 'u1' });
    const save = tools.find((t) => t.name === 'save_memory')!;
    const result = await save.invoke({ namespace: 'ns', key: 'k', value: { fact: 'x' } } as never);
    expect(String(result)).toMatch(/saved/i);
  });
});
```

- [ ] **Step 2: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/memory-tools.test.ts`
Expected: FAIL — cannot find `./memory-tools`.

- [ ] **Step 3: Implement**

Create `libs/claw-studio/src/agent/memory-tools.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { searchMemory, saveMemory } from './persistence';

const logger = createLogger('claw-studio:memory-tools');

export function createMemoryTools(deps: { tenantId: string; userId: string }) {
  const { tenantId, userId } = deps;

  const searchMemoryTool = tool(
    async ({ query, namespacePrefix, limit }) => {
      try {
        const hits = await searchMemory(
          tenantId, userId,
          namespacePrefix ? namespacePrefix.split('/') : [],
          query, limit ?? 5,
        );
        if (hits.length === 0) return 'No matching memories found.';
        return hits.map((h: any, i: number) => `${i + 1}. [${h.namespace}/${h.key}] ${JSON.stringify(h.value)}`).join('\n');
      } catch (error) {
        logger.error({ error, tenantId, userId }, 'search_memory tool failed');
        return 'Memory search is temporarily unavailable.';
      }
    },
    {
      name: 'search_memory',
      description: 'Search Claw\'s long-term memory for facts, past outcomes, or learned rules relevant to a query.',
      schema: z.object({
        query: z.string().describe('what to search for'),
        namespacePrefix: z.string().optional().describe('optional namespace filter, e.g. "user/preferences"'),
        limit: z.number().optional(),
      }),
    },
  );

  const saveMemoryTool = tool(
    async ({ namespace, key, value }) => {
      try {
        await saveMemory(tenantId, userId, namespace.split('/'), key, value as Record<string, unknown>);
        return `Saved memory ${namespace}/${key}.`;
      } catch (error) {
        logger.error({ error, tenantId, userId, namespace, key }, 'save_memory tool failed');
        return 'Failed to save that memory — continuing without it.';
      }
    },
    {
      name: 'save_memory',
      description: 'Explicitly save a fact worth remembering across future conversations. Prefer letting the automatic memory-save step handle this; use this tool only when the user explicitly asks you to remember something right now.',
      schema: z.object({
        namespace: z.string().describe('slash-separated namespace, e.g. "user/preferences"'),
        key: z.string(),
        value: z.record(z.string(), z.unknown()),
      }),
    },
  );

  return [searchMemoryTool, saveMemoryTool];
}
```

- [ ] **Step 4: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { createMemoryTools } from './agent/memory-tools';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/memory-tools.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): search_memory/save_memory tools bound into the graph"
```

---

### Task 6: The real Claw graph — full topology, replacing the C1 stub

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-graph.ts` (full rewrite)
- Modify: `libs/claw-studio/src/agent/claw-graph.test.ts` (replaces the 2 C1-stub tests with tests against the real graph — see Global Constraints)
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces: `createClawGraph(deps: ClawGraphDeps)` → a compiled `StateGraph` over `ClawGraphAnnotation`, where:

```ts
export interface ClawGraphDeps {
  model: BaseChatModel;
  reflectorModel?: BaseChatModel; // defaults to `model` if omitted
  systemPrompt?: string;
  tools?: StructuredToolInterface[];
  tenantId?: string;
  userId?: string;            // Claw's identity for memory nodes — see Plan C2 convention
  store?: unknown | null;     // PostgresMemoryStore from persistence.ts, or null in tests
  checkpointer?: BaseCheckpointSaver;
  autoApprove?: boolean;      // Claw.autoApprove — gates interruptBefore
  maxIterations?: number;     // default 25
}
```

- [ ] **Step 1:** Read `apps/web-ui/lib/agent-ops/executor-graphs.ts` in nucleus in full before writing this file. Cross-check every routing function (`routeFromEvaluator`, `routeFromPlanner`, `routeFromGenerate`, `routeFromGenerateToTools`, `routeFromTools`, `routeFromReflect`, `routeFromRevise`) and the `interruptBefore` compile step against the code below — this plan's version is a faithful adaptation but the installed LangGraph API surface (e.g. exact `addConditionalEdges` signature) must be verified live.

- [ ] **Step 2: Replace the existing stub tests** (they assert single-node behavior that no longer holds once the graph has multiple LLM calls before the first assistant reply)

Replace `libs/claw-studio/src/agent/claw-graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { createClawGraph } from './claw-graph';

// Scripted responses drive the graph node-by-node: evaluator → planner →
// generate (no tool calls, plain reply) → final. reflect is skipped because
// iterationCount<=1 on first generate with no tool calls.
function scriptedResponses() {
  return [
    JSON.stringify({ mode: 'plan', requiresApproval: false, skillId: null }), // evaluator
    JSON.stringify([{ step: 'Answer the question', status: 'pending' }]),    // planner
    'Hello from Claw',                                                       // generate
    '## What Was Accomplished\nAnswered the question.\n## Key Findings\nNone.\n## Errors\nNone.\n## Next Steps\nNone.', // final
  ];
}

describe('createClawGraph — full topology', () => {
  it('routes a trivial task through evaluator → planner → generate → final', async () => {
    const model = new FakeListChatModel({ responses: scriptedResponses() });
    const graph = createClawGraph({ model, autoApprove: true });
    const result = await graph.invoke(
      { messages: [new HumanMessage('What time zone is the team in?')] },
      { configurable: { thread_id: 'test-thread-1' } },
    );
    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toContain('What Was Accomplished');
    expect(result.isComplete).toBe(true);
  });

  it('asks a clarifying question and stops when the evaluator returns mode:end', async () => {
    const model = new FakeListChatModel({
      responses: [JSON.stringify({ mode: 'end', requiresApproval: false, skillId: null, clarificationQuestion: 'Which environment?' })],
    });
    const graph = createClawGraph({ model, autoApprove: true });
    const result = await graph.invoke(
      { messages: [new HumanMessage('restart it')] },
      { configurable: { thread_id: 'test-thread-2' } },
    );
    expect(result.clarificationQuestion).toBe('Which environment?');
    expect(result.nextAction).toBe('awaiting_input');
  });

  it('interrupts before approval_gate when the plan requires approval and autoApprove is off', async () => {
    const model = new FakeListChatModel({
      responses: [
        JSON.stringify({ mode: 'plan', requiresApproval: true, skillId: null }),
        JSON.stringify([{ step: 'Do something risky', status: 'pending' }]),
      ],
    });
    const graph = createClawGraph({ model, autoApprove: false });
    const config = { configurable: { thread_id: 'test-thread-3' } };
    await graph.invoke({ messages: [new HumanMessage('delete the old records')] }, config);
    const state = await graph.getState(config);
    expect(state.next).toContain('approval_gate');
  });

  it('resumes an interrupted run via updateState and completes it', async () => {
    const model = new FakeListChatModel({
      responses: [
        JSON.stringify({ mode: 'plan', requiresApproval: true, skillId: null }),
        JSON.stringify([{ step: 'Do something risky', status: 'pending' }]),
        'Done.',
        '## What Was Accomplished\nDone.\n## Key Findings\nNone.\n## Errors\nNone.\n## Next Steps\nNone.',
      ],
    });
    const graph = createClawGraph({ model, autoApprove: false });
    const config = { configurable: { thread_id: 'test-thread-4' } };
    await graph.invoke({ messages: [new HumanMessage('delete the old records')] }, config);

    await graph.updateState(config, { approvalStatus: 'approved', pendingToolApprovals: [], nextAction: 'generate' });
    const result = await graph.invoke(null, config);

    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toContain('What Was Accomplished');
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-graph.test.ts`
Expected: FAIL — the current stub graph has none of the nodes these tests exercise.

- [ ] **Step 4: Implement the full graph**

Replace `libs/claw-studio/src/agent/claw-graph.ts`:

```ts
/**
 * claw-graph.ts
 *
 * Claw's executor graph — a faithful clone of nucleus Agent Ops'
 * executor-graphs.ts topology, adapted to Claw Studio: no Accounts, no
 * Knowledge Base, skill selection stubbed to null (Plan C4 wires it), tools
 * bound so far are just search_memory/save_memory (Plan C5 adds MCP tools).
 *
 * Node responsibilities mirror the reference exactly:
 *   memory_recall → evaluator →(end)→ clarify
 *                            →(plan)→ planner →(needs approval)→ approval_gate
 *                                            →(else)→ generate ⇄ tools ⇄ reflect → revise
 *                                                        └(mutative call)→ mutative_approval_gate
 *                                                        → final → memory_save
 *
 * HITL: interruptBefore on approval_gate + mutative_approval_gate, compiled
 * only when autoApprove is off. Resume is `graph.updateState(config, {...})`
 * followed by `graph.invoke(null, config)` — LangGraph's standard
 * checkpoint-resume pattern.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createLogger } from '@chatbot/shared';
import { ClawGraphAnnotation, type ClawGraphState, type RequestEvaluation } from './executor-state';
import { classifyTool, filterMutativeToolCalls } from './tool-classifier';
import {
  buildIdentityPrompt, buildEvaluatorPrompt, buildPlannerPrompt,
  buildGenerateSystemPrompt, buildMutationInstruction, buildReflectPrompt,
  buildRevisePrompt, buildFinalPrompt,
} from './prompt-templates';
import { extractTextContent } from './agent-shared';
import { createMemoryRecallNode, createMemorySaveNode } from '../memory/memory-nodes';

const logger = createLogger('claw-studio:claw-graph');

const DEFAULT_MAX_ITERATIONS = 25;
const STALL_LIMIT = 2;

export interface ClawGraphDeps {
  model: BaseChatModel;
  reflectorModel?: BaseChatModel;
  systemPrompt?: string;
  tools?: StructuredToolInterface[];
  tenantId?: string;
  userId?: string;
  store?: unknown | null;
  checkpointer?: BaseCheckpointSaver;
  autoApprove?: boolean;
  maxIterations?: number;
}

function parseJsonObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(text: string): T[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T[];
  } catch {
    return null;
  }
}

export function createClawGraph(deps: ClawGraphDeps) {
  const {
    model, systemPrompt, tenantId, userId, store,
    autoApprove = false, maxIterations = DEFAULT_MAX_ITERATIONS,
  } = deps;
  const reflectorModel = deps.reflectorModel ?? model;
  const tools = deps.tools ?? [];
  const modelWithTools = tools.length > 0 ? model.bindTools(tools) : model;
  const identity = buildIdentityPrompt(systemPrompt);

  const memoryRecallNode = createMemoryRecallNode({ reflectorModel, tenantId, userId, store: store ?? null });
  const memorySaveNode = createMemorySaveNode({ reflectorModel, tenantId, userId, store: store ?? null });

  // ── evaluator ──────────────────────────────────────────────────────────
  async function evaluatorNode(state: ClawGraphState) {
    try {
      const lastHuman = [...state.messages].reverse().find((m) => m._getType() === 'human');
      const taskDescription = lastHuman ? extractTextContent(lastHuman.content) : state.taskDescription;
      const response = await reflectorModel.invoke([
        new SystemMessage(buildEvaluatorPrompt()),
        new HumanMessage(taskDescription),
      ]);
      const parsed = parseJsonObject<RequestEvaluation>(extractTextContent(response.content));
      // Fail-open: an unparseable evaluation defaults to "proceed to planning,
      // no approval flagged" rather than blocking the turn.
      const evaluation: RequestEvaluation = parsed ?? { mode: 'plan', requiresApproval: false, skillId: null };
      return { evaluation, taskDescription };
    } catch (error) {
      logger.warn({ error, tenantId, userId }, '[evaluator] failed — defaulting to plan mode');
      return { evaluation: { mode: 'plan', requiresApproval: false, skillId: null } as RequestEvaluation };
    }
  }

  function routeFromEvaluator(state: ClawGraphState): 'clarify' | 'planner' {
    return state.evaluation?.mode === 'end' ? 'clarify' : 'planner';
  }

  // ── clarify ────────────────────────────────────────────────────────────
  async function clarifyNode(state: ClawGraphState) {
    return {
      clarificationQuestion: state.evaluation?.clarificationQuestion ?? 'Could you clarify what you\'d like me to do?',
      nextAction: 'awaiting_input',
    };
  }

  // ── planner ────────────────────────────────────────────────────────────
  async function plannerNode(state: ClawGraphState) {
    try {
      const response = await model.invoke([
        new SystemMessage(buildPlannerPrompt()),
        new HumanMessage(state.taskDescription || 'Continue the conversation.'),
      ]);
      const text = extractTextContent(response.content);
      const parsed = parseJsonArray<{ step: string; status?: string }>(text);
      const plan = (parsed ?? [{ step: state.taskDescription || 'Respond to the user', status: 'pending' }])
        .map((p) => ({ step: p.step, status: (p.status ?? 'pending') as 'pending' }));
      return { plan, messages: [new AIMessage({ content: `Plan:\n${plan.map((p) => `- ${p.step}`).join('\n')}` })] };
    } catch (error) {
      logger.warn({ error, tenantId, userId }, '[planner] failed — falling back to a single-step plan');
      return { plan: [{ step: state.taskDescription || 'Respond to the user', status: 'pending' as const }] };
    }
  }

  function routeFromPlanner(state: ClawGraphState): 'approval_gate' | 'generate' {
    if (!autoApprove && state.evaluation?.requiresApproval && state.approvalStatus !== 'approved') {
      return 'approval_gate';
    }
    return 'generate';
  }

  // ── approval_gate (plan-level; paused via interruptBefore) ────────────
  async function approvalGateNode() {
    return { nextAction: 'awaiting_approval', approvalStatus: 'pending' as const };
  }

  // ── generate ───────────────────────────────────────────────────────────
  async function generateNode(state: ClawGraphState) {
    const mutationInstruction = buildMutationInstruction({
      requiresApproval: state.evaluation?.requiresApproval ?? false,
      autoApprove,
    });
    const systemText = buildGenerateSystemPrompt({
      identity, memoryContext: state.memoryContext, plan: state.plan, mutationInstruction,
    });
    const response = await modelWithTools.invoke([new SystemMessage(systemText), ...state.messages]);
    const plan = state.plan.map((p, i) => (i === 0 && p.status === 'pending' ? { ...p, status: 'in_progress' as const } : p));
    return { messages: [response], iterationCount: state.iterationCount + 1, plan };
  }

  function routeFromGenerateToTools(state: ClawGraphState): 'tools' | 'mutative_approval_gate' {
    if (autoApprove || state.approvalStatus === 'approved') return 'tools';
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const mutative = filterMutativeToolCalls(last.tool_calls ?? []);
    return mutative.length > 0 ? 'mutative_approval_gate' : 'tools';
  }

  function routeFromGenerate(state: ClawGraphState): 'tools' | 'mutative_approval_gate' | 'final' | 'reflect' {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    if (last.tool_calls && last.tool_calls.length > 0) return routeFromGenerateToTools(state);
    if (state.iterationCount <= 1) return 'final';
    return 'reflect';
  }

  // ── tools ──────────────────────────────────────────────────────────────
  const toolNode = new ToolNode(tools);
  async function collectingToolNode(state: ClawGraphState) {
    const result = await toolNode.invoke(state);
    const toolMessages = (result.messages ?? []) as ToolMessage[];
    const toolResults = toolMessages.map((m, idx) => ({
      toolName: String(m.name ?? 'unknown'),
      output: extractTextContent(m.content).slice(0, 1000),
      isError: /error|exception/i.test(extractTextContent(m.content)),
      iterationIndex: state.iterationCount + idx,
    }));
    return {
      messages: toolMessages,
      toolResults,
      // Reset after each batch — approval doesn't carry across the whole
      // run, only the batch it was granted for (matches nucleus exactly).
      approvalStatus: null,
      pendingToolApprovals: [],
    };
  }

  function routeFromTools(state: ClawGraphState): 'generate' | 'reflect' {
    return state.iterationCount >= maxIterations ? 'reflect' : 'generate';
  }

  // ── mutative_approval_gate (paused via interruptBefore) ───────────────
  async function mutativeApprovalGateNode(state: ClawGraphState) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const mutativeNames = filterMutativeToolCalls(last.tool_calls ?? []).map((c) => c.name);
    return { nextAction: 'awaiting_tool_approval', approvalStatus: 'pending' as const, pendingToolApprovals: mutativeNames };
  }

  // ── reflect ────────────────────────────────────────────────────────────
  async function reflectNode(state: ClawGraphState) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    if (last.tool_calls && last.tool_calls.length > 0) return {};

    try {
      const response = await reflectorModel.invoke([
        new SystemMessage(buildReflectPrompt()),
        new HumanMessage(`Plan:\n${state.plan.map((p) => `- [${p.status}] ${p.step}`).join('\n')}\n\nLast response:\n${extractTextContent(last.content)}`),
      ]);
      const text = extractTextContent(response.content);
      const parsed = parseJsonObject<{ isComplete: boolean; issues: string[]; updatedPlan?: { step: string; status: string }[] }>(text);

      // Empty/unparseable reflection is treated as its own stall signal —
      // never silently reset the counter (matches nucleus exactly; the
      // reference's own comment cites a real 1.4M-token runaway incident
      // this hardening prevents).
      const issue = parsed?.issues?.[0] ?? (parsed ? null : 'EMPTY_REFLECTION');
      const stalled = issue !== null && issue === state.reflection;
      const reflectionStallCount = stalled ? state.reflectionStallCount + 1 : 0;

      return {
        reflection: issue ?? '',
        isComplete: parsed?.isComplete ?? true,
        plan: parsed?.updatedPlan?.map((p) => ({ step: p.step, status: p.status as never })) ?? state.plan,
        reflectionStallCount,
      };
    } catch (error) {
      logger.warn({ error, tenantId, userId }, '[reflect] failed — treating as complete to avoid a stuck run');
      return { isComplete: true };
    }
  }

  function routeFromReflect(state: ClawGraphState): 'final' | 'revise' {
    const stalled = state.reflectionStallCount >= STALL_LIMIT;
    const maxedOut = state.iterationCount >= maxIterations;
    return state.isComplete || maxedOut || stalled ? 'final' : 'revise';
  }

  // ── revise ─────────────────────────────────────────────────────────────
  async function reviseNode(state: ClawGraphState) {
    const systemText = buildRevisePrompt({ analysis: state.reflection, issues: state.reflection ? [state.reflection] : [] });
    const response = await modelWithTools.invoke([new SystemMessage(systemText), ...state.messages]);
    return { messages: [response], iterationCount: state.iterationCount + 1 };
  }

  function routeFromRevise(state: ClawGraphState): 'tools' | 'mutative_approval_gate' | 'reflect' {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    if (last.tool_calls && last.tool_calls.length > 0) return routeFromGenerateToTools(state);
    return 'reflect';
  }

  // ── final ──────────────────────────────────────────────────────────────
  async function finalNode(state: ClawGraphState) {
    const recentResults = state.toolResults.slice(-3).map((r) => `[${r.toolName}] ${r.output}`).join('\n');
    const response = await reflectorModel.invoke([
      new SystemMessage(buildFinalPrompt()),
      new HumanMessage(`Plan:\n${state.plan.map((p) => `- [${p.status}] ${p.step}`).join('\n')}\n\nRecent tool results:\n${recentResults || '(none)'}\n\nReflection notes: ${state.reflection || '(none)'}`),
    ]);
    return { messages: [response], isComplete: true };
  }

  // ── graph assembly ───────────────────────────────────────────────────
  const graph = new StateGraph(ClawGraphAnnotation)
    .addNode('memory_recall', memoryRecallNode)
    .addNode('evaluator', evaluatorNode)
    .addNode('clarify', clarifyNode)
    .addNode('planner', plannerNode)
    .addNode('approval_gate', approvalGateNode)
    .addNode('generate', generateNode)
    .addNode('tools', collectingToolNode)
    .addNode('mutative_approval_gate', mutativeApprovalGateNode)
    .addNode('reflect', reflectNode)
    .addNode('revise', reviseNode)
    .addNode('final', finalNode)
    .addNode('memory_save', memorySaveNode)
    .addEdge(START, 'memory_recall')
    .addEdge('memory_recall', 'evaluator')
    .addConditionalEdges('evaluator', routeFromEvaluator, { clarify: 'clarify', planner: 'planner' })
    .addEdge('clarify', END)
    .addConditionalEdges('planner', routeFromPlanner, { approval_gate: 'approval_gate', generate: 'generate' })
    .addEdge('approval_gate', END)
    .addConditionalEdges('generate', routeFromGenerate, {
      tools: 'tools', mutative_approval_gate: 'mutative_approval_gate', final: 'final', reflect: 'reflect',
    })
    .addConditionalEdges('tools', routeFromTools, { generate: 'generate', reflect: 'reflect' })
    .addEdge('mutative_approval_gate', END)
    .addConditionalEdges('reflect', routeFromReflect, { final: 'final', revise: 'revise' })
    .addConditionalEdges('revise', routeFromRevise, {
      tools: 'tools', mutative_approval_gate: 'mutative_approval_gate', reflect: 'reflect',
    })
    .addEdge('final', 'memory_save')
    .addEdge('memory_save', END);

  const compileOptions: { checkpointer?: BaseCheckpointSaver; interruptBefore?: string[] } = {};
  if (deps.checkpointer) compileOptions.checkpointer = deps.checkpointer;
  if (!autoApprove) compileOptions.interruptBefore = ['approval_gate', 'mutative_approval_gate'];

  return graph.compile(compileOptions);
}
```

- [ ] **Step 5: Run tests, fix any LangGraph API drift**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-graph.test.ts`
Expected: PASS (4 tests). If `addConditionalEdges`/`StateGraph`/`ToolNode` signatures differ from the installed `@langchain/langgraph` version, adjust and note the deviation in the commit message — do not silently paper over a type error with `any`.

Run: `bunx nx typecheck claw-studio` → no errors.
Run: `cd libs/claw-studio && bunx vitest run` → all tests in the lib pass (no regressions in memory/persistence tests from Plans C1–C2).

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): full executor graph (clone of Agent Ops), replaces C1 stub"
```

---

### Task 7: `claw-runtime.ts` — resolve Claw, conversation thread, and compiled graph

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts` (full rewrite)
- Test: `libs/claw-studio/src/agent/claw-runtime.test.ts` (extend existing)
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces:
  - `getOrCreateClawConversation(clawId: string): Promise<{ id: string; threadId: string }>` — Phase 1's single-conversation-per-Claw helper.
  - `resolveClawRuntime(input: { tenantId: string; clawStudioId?: string }): Promise<ClawRuntime>` where:
    ```ts
    interface ClawRuntime {
      graph: ReturnType<typeof createClawGraph>;
      threadId: string;
      clawId: string;
      autoApprove: boolean;
      config: { configurable: { thread_id: string; tenant_id: string; user_id: string } };
    }
    ```

- [ ] **Step 1: Write the failing test**

Extend `libs/claw-studio/src/agent/claw-runtime.test.ts` (read the existing file first; add):

```ts
// (add to the existing test file, alongside whatever resolveClawGraph coverage already exists)
import { describe, it, expect, vi } from 'vitest';

vi.mock('@chatbot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatbot/shared')>();
  return {
    ...actual,
    getPrismaClient: vi.fn(() => ({
      claw: { findFirst: vi.fn(async () => ({ id: 'claw_1', name: 'Claw', systemPrompt: null, autoApprove: false, providerModelId: null })) },
      clawConversation: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'conv_1', threadId: 'thread_generated_1' })),
      },
    })),
    LlmProviderService: vi.fn().mockImplementation(() => ({
      getDefaultConfig: vi.fn(async () => ({ provider: 'bedrock', chatModel: 'test-model', region: 'us-east-1', accessKeyId: 'a', secretAccessKey: 'b' })),
    })),
  };
});

import { getOrCreateClawConversation, resolveClawRuntime } from './claw-runtime';

describe('getOrCreateClawConversation', () => {
  it('creates a new conversation with a generated threadId when none exists', async () => {
    const result = await getOrCreateClawConversation('claw_1');
    expect(result.threadId).toBe('thread_generated_1');
  });
});

describe('resolveClawRuntime', () => {
  it('resolves a runtime bundle scoped to the tenant\'s Claw and its thread', async () => {
    const runtime = await resolveClawRuntime({ tenantId: 'tenant_1' });
    expect(runtime.clawId).toBe('claw_1');
    expect(runtime.config.configurable.thread_id).toBe('thread_generated_1');
    expect(runtime.config.configurable.tenant_id).toBe('tenant_1');
    expect(runtime.config.configurable.user_id).toBe('claw_1');
    expect(runtime.autoApprove).toBe(false);
  });
});
```

- [ ] **Step 2: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-runtime.test.ts`
Expected: FAIL — `getOrCreateClawConversation`/`resolveClawRuntime` don't exist yet.

- [ ] **Step 3: Implement**

Replace `libs/claw-studio/src/agent/claw-runtime.ts`:

```ts
import crypto from 'crypto';
import { LlmProviderService, getPrismaClient, createLogger } from '@chatbot/shared';
import { createClawModel } from './model-factory';
import { createClawGraph } from './claw-graph';
import { createMemoryTools } from './memory-tools';
import { getCheckpointer, getMemoryStore } from './persistence';

const logger = createLogger('claw-studio:runtime');

export interface ClawRuntime {
  graph: ReturnType<typeof createClawGraph>;
  threadId: string;
  clawId: string;
  autoApprove: boolean;
  config: { configurable: { thread_id: string; tenant_id: string; user_id: string } };
}

export async function getOrCreateClawConversation(clawId: string): Promise<{ id: string; threadId: string }> {
  const db = getPrismaClient();
  const existing = await db.clawConversation.findFirst({ where: { clawId } });
  if (existing) return { id: existing.id, threadId: existing.threadId };

  const threadId = `claw_${clawId}_${crypto.randomBytes(9).toString('base64url')}`;
  const created = await db.clawConversation.create({
    data: { clawId, threadId, title: 'Conversation with Claw' },
  });
  logger.info({ clawId, threadId }, 'Created Claw conversation thread');
  return { id: created.id, threadId: created.threadId };
}

export async function resolveClawRuntime(input: { tenantId: string }): Promise<ClawRuntime> {
  const { tenantId } = input;
  const db = getPrismaClient();

  const clawStudio = await db.clawStudio.findFirst({ where: { tenantId }, include: { claws: true } });
  const claw = clawStudio?.claws[0];
  if (!claw) {
    throw new Error('No Claw provisioned for this tenant');
  }

  const config = claw.providerModelId
    ? await new LlmProviderService(tenantId).getConfigById(claw.providerModelId)
    : await new LlmProviderService(tenantId).getDefaultConfig();
  if (!config) {
    throw new Error('No LLM provider configured for this tenant');
  }

  const model = createClawModel(config);
  const { threadId } = await getOrCreateClawConversation(claw.id);
  const [checkpointer, store] = await Promise.all([getCheckpointer(), getMemoryStore()]);
  const tools = createMemoryTools({ tenantId, userId: claw.id });

  logger.info(
    { tenantId, clawId: claw.id, threadId, provider: config.provider, model: config.chatModel, autoApprove: claw.autoApprove },
    'Resolved Claw runtime',
  );

  const graph = createClawGraph({
    model,
    systemPrompt: claw.systemPrompt ?? undefined,
    tools,
    tenantId,
    userId: claw.id,
    store,
    checkpointer,
    autoApprove: claw.autoApprove,
  });

  return {
    graph,
    threadId,
    clawId: claw.id,
    autoApprove: claw.autoApprove,
    config: { configurable: { thread_id: threadId, tenant_id: tenantId, user_id: claw.id } },
  };
}
```

- [ ] **Step 4: Export + run tests**

Update `libs/claw-studio/src/index.ts` — replace the old `export { resolveClawGraph } from './agent/claw-runtime';` line with:

```ts
export { resolveClawRuntime, getOrCreateClawConversation } from './agent/claw-runtime';
export type { ClawRuntime } from './agent/claw-runtime';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-runtime.test.ts` → PASS.
Run: `bunx nx typecheck claw-studio` → no errors.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): resolve Claw runtime (model + graph + thread) scoped to tenant"
```

---

### Task 8: Mission Control chat route — thread persistence + approval + resume

**Files:**
- Modify: `apps/mission-control/app/api/chat/route.ts` (full rewrite)
- Modify: `apps/mission-control/tsconfig.json` / `next.config.ts` if new transitive imports need transpiling (verify by build)

**Interfaces:**
- `POST /api/chat` body (Zod): `{ message: string } | { decision: 'approve' | 'reject' }` (mutually exclusive via a discriminated union).
- SSE events: `token` (unchanged), `done` (unchanged), `error` (unchanged), plus **new**: `approval` — `data: { kind: 'plan' | 'tool'; plan?: PlanStep[]; pendingTools?: string[] }` emitted instead of `done` when the graph paused on an interrupt.
- `DELETE /api/chat` — aborts the in-flight run for the caller's thread via `run-manager.ts`.

- [ ] **Step 1: Implement**

Replace `apps/mission-control/app/api/chat/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { resolveClawRuntime, registerRun, cancelRun, cleanupRun } from '@chatbot/claw-studio';
import { HumanMessage } from '@langchain/core/messages';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat');

const bodySchema = z.union([
  z.object({ message: z.string().min(1) }),
  z.object({ decision: z.enum(['approve', 'reject']) }),
]);

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (
          part && typeof part === 'object' && 'text' in part &&
          typeof (part as { text: unknown }).text === 'string' &&
          (!('type' in part) || (part as { type: unknown }).type === 'text')
        ) {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

export async function POST(req: NextRequest) {
  let threadId: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 });
    }

    const tenantId = session.studio.tenantId;
    const runtime = await resolveClawRuntime({ tenantId });
    threadId = runtime.threadId;
    const abortController = registerRun(threadId);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if ('decision' in parsed.data) {
            if (parsed.data.decision === 'approve') {
              await runtime.graph.updateState(runtime.config, {
                approvalStatus: 'approved', pendingToolApprovals: [], nextAction: 'generate',
              });
            } else {
              await runtime.graph.updateState(runtime.config, {
                approvalStatus: 'rejected', pendingToolApprovals: [], nextAction: 'final',
              });
            }
          } else {
            await runtime.graph.updateState(runtime.config, {}); // no-op if the thread has no prior checkpoint
          }

          const input = 'decision' in parsed.data ? null : { messages: [new HumanMessage(parsed.data.message)] };
          const events = await runtime.graph.stream(input, {
            ...runtime.config,
            streamMode: 'messages',
            signal: abortController.signal,
          });

          for await (const [chunk] of events as AsyncIterable<[{ content: unknown }]>) {
            const text = extractText(chunk.content);
            if (text) controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(text)}\n\n`));
          }

          const state = await runtime.graph.getState(runtime.config);
          if (state.next && state.next.length > 0) {
            const kind = state.next.includes('mutative_approval_gate') ? 'tool' : 'plan';
            const payload = kind === 'tool'
              ? { kind, pendingTools: state.values.pendingToolApprovals }
              : { kind, plan: state.values.plan };
            controller.enqueue(encoder.encode(`event: approval\ndata: ${JSON.stringify(payload)}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          }
        } catch (err) {
          logger.error({ err, tenantId, threadId }, 'Claw stream failed');
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify('Claw encountered an error. Please try again.')}\n\n`),
          );
        } finally {
          if (threadId) cleanupRun(threadId);
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    logger.error({ error, threadId }, 'Chat route failed');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const runtime = await resolveClawRuntime({ tenantId: session.studio.tenantId });
    const cancelled = cancelRun(runtime.threadId);
    return new Response(JSON.stringify({ cancelled }), { status: 200 });
  } catch (error) {
    logger.error({ error }, 'Chat cancel failed');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

> **Note on `graph.updateState(runtime.config, {})` for the plain-message path:** this is a defensive no-op call and may not be necessary depending on the installed LangGraph version's handling of a first-ever invoke on a thread with no checkpoint — verify during implementation whether it's needed or whether `graph.stream(input, config)` alone correctly initializes a fresh thread; remove the no-op call if it does, and note the removal in the commit.

- [ ] **Step 2: Verify build + typecheck**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Run: `bunx nx build mission-control` → success.

- [ ] **Step 3: Manual/integration verification**

With a provisioned Studio and a tenant LLM provider configured: log into Mission Control, send a plain message in `/chat`, confirm token streaming + `done` still works exactly as before (regression check on the C1 behavior). Then send a message designed to trip `requiresApproval` (e.g., something explicitly asking for a destructive-sounding action) with the Claw's `autoApprove` off, and confirm an `approval` SSE frame arrives instead of `done`. If live model access isn't available in this environment, this is an environment limit — report DONE_WITH_CONCERNS and instead prove the wiring with an integration test using `FakeListChatModel` swapped in via a test-only `resolveClawRuntime` seam, asserting the SSE stream emits `approval` when the graph interrupts. State clearly which verification path was taken.

- [ ] **Step 4: Commit**

```bash
git add apps/mission-control/app/api/chat
git commit -m "feat(mission-control): thread-persisted chat with approval/resume + cancel"
```

---

### Task 9: Chat UI — approval banner + stop button

**Files:**
- Modify: `apps/mission-control/hooks/use-claw-chat.ts`
- Modify: `apps/mission-control/app/(console)/chat/page.tsx`

**Interfaces:**
- `useClawChat()` gains: `pendingApproval: { kind: 'plan' | 'tool'; plan?: PlanStep[]; pendingTools?: string[] } | null`, `respondToApproval(decision: 'approve' | 'reject'): Promise<void>`, `stopGenerating(): void`.

- [ ] **Step 1: Extend the hook**

In `apps/mission-control/hooks/use-claw-chat.ts`, add an `approval` SSE-event branch alongside the existing `token`/`error`/`done` handling, and add `respondToApproval`/`stopGenerating`:

```ts
// Add to ClawChatMessage's sibling state:
const [pendingApproval, setPendingApproval] = useState<
  { kind: 'plan' | 'tool'; plan?: { step: string; status: string }[]; pendingTools?: string[] } | null
>(null);

// Inside the SSE frame loop's if/else chain, add a branch:
// } else if (parsed.event === 'approval') {
//   setPendingApproval(JSON.parse(parsed.data));
//   shouldStop = true;
//   break;
// }

// New function alongside sendMessage:
const respondToApproval = useCallback(
  async (decision: 'approve' | 'reject') => {
    setPendingApproval(null);
    setIsStreaming(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      // reuse the same SSE-reading loop as sendMessage — extract that loop into
      // a shared `consumeStream(res, assistantId)` helper called by both
      // sendMessage and respondToApproval to avoid duplicating the parser.
    } finally {
      setIsStreaming(false);
    }
  },
  [],
);

const stopGenerating = useCallback(() => {
  void fetch('/api/chat', { method: 'DELETE' });
}, []);
```

> Refactor note: both `sendMessage` and `respondToApproval` need the same SSE-frame-parsing loop. Extract it into a private `consumeStream(res: Response, assistantId: string): Promise<void>` closure inside the hook body and call it from both, rather than duplicating the `while(true)` reader loop.

- [ ] **Step 2: Render the approval banner**

In `apps/mission-control/app/(console)/chat/page.tsx`, destructure `pendingApproval`, `respondToApproval`, `stopGenerating` from `useClawChat()` and render, just above the input row, when `pendingApproval` is set:

```tsx
{pendingApproval && (
  <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
    <p className="mb-2 text-sm font-medium">
      {pendingApproval.kind === 'plan'
        ? 'Claw wants to proceed with this plan — approve to continue:'
        : `Claw wants to run: ${pendingApproval.pendingTools?.join(', ')}`}
    </p>
    {pendingApproval.plan && (
      <ul className="mb-3 list-disc pl-5 text-sm text-muted-foreground">
        {pendingApproval.plan.map((p, i) => <li key={i}>{p.step}</li>)}
      </ul>
    )}
    <div className="flex gap-2">
      <Button size="sm" onClick={() => respondToApproval('approve')}>Approve</Button>
      <Button size="sm" variant="outline" onClick={() => respondToApproval('reject')}>Reject</Button>
    </div>
  </div>
)}
```

Add a "Stop" button next to the Send button, visible only while `isStreaming`, calling `stopGenerating()`.

- [ ] **Step 3: Typecheck + manual verification**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Manual: drive a chat turn that trips approval; confirm the banner renders with Approve/Reject; click Approve; confirm the run resumes and completes. Click Stop mid-stream on a separate turn; confirm the stream halts.

- [ ] **Step 4: Commit**

```bash
git add apps/mission-control/hooks/use-claw-chat.ts "apps/mission-control/app/(console)/chat"
git commit -m "feat(mission-control): approval banner + stop-generating control in Chat with Claw"
```

---

### Task 10: Full-lib verification

- [ ] **Step 1:** Run: `cd libs/claw-studio && bunx vitest run` → all tests pass (Tasks 1–7 plus untouched C1/C2 tests).
- [ ] **Step 2:** Run: `bunx nx typecheck claw-studio` and `bunx nx typecheck mission-control` → no errors.
- [ ] **Step 3:** Run: `bunx nx build claw-studio` and `bunx nx build mission-control` → both succeed.
- [ ] **Step 4:** Commit any final fixups discovered during full-lib verification as a single `fix(claw-studio): C3 typecheck/build fixups` commit if needed.

---

## Self-Review

**Spec coverage:** design spec §7's full node list (`memory_recall → evaluator(skill-select) → planner → [approval_gate] → generate ⇄ tools ⇄ reflect → revise → final → memory_save`) is implemented end to end (Task 6), thread-persisted via `ClawConversation` (Task 7), with HITL wired to `Claw.autoApprove` (Tasks 6, 8, 9) exactly as §7/§10 specify. §8's reuse-map row "Graph / state / prompts ← executor-graphs/executor-state/tool-classifier/run-manager/prompt-templates" is covered by Tasks 1–4, 6.

**Deliberately deferred (out of scope, next plans):** real skill selection (evaluator's `skillId` stays `null` — Plan C4), MCP tools (Plan C5), scheduled/autonomous triggering of this graph (Plan C6), gateway connectors (Plan C7). Knowledge-base auto-select and Account/AWS-STS context are dropped permanently, not deferred — Claw Studio has no equivalent concepts.

**Port fidelity:** Tasks 1, 2, 4, 6 clone nucleus' state shape, tool-classification tiers, cancellation registry, and full node/routing topology structurally verbatim; Task 3 clones prompt *contracts and structure* verbatim, adapting only persona copy. Every ported-file task opens with "read the current nucleus source" per the Global Constraints, consistent with Plan C2's own convention.

**Known risk:** this plan's graph code was authored from a detailed research pass over the live nucleus source, not a byte-for-byte transcription — Task 6 Step 5 explicitly calls out verifying `StateGraph`/`addConditionalEdges`/`ToolNode`/`ClientCheckpointSaver` signatures against the installed `@langchain/langgraph` version and fixing drift rather than forcing it with `any`. The existing `claw-graph.test.ts` is intentionally replaced (Global Constraints), since the C1 stub's tests assert single-node behavior a multi-node graph no longer exhibits.

**Type consistency:** `ClawGraphState` (Task 1) is a structural superset of `MemoryNodeState` (existing `memory/types.ts`), so `createMemoryRecallNode`/`createMemorySaveNode` from Plan C2 consume it without modification. `ClawRuntime.config.configurable` (`{thread_id, tenant_id, user_id}`) matches exactly what `memory-nodes.ts`'s `MemoryNodeDeps` and `memorySaveNode`'s `runtimeConfig?.configurable` already expect (Plan C2 code, unmodified). `RequestEvaluation.skillId: null` is the exact seam Plan C4 will fill in.

---

## Next plans (not in this document)

- **Plan C4 — Skills:** `ClawSkill` Prisma model, port `lib/agent/memory/skill-synthesis.ts` (un-stubs C2's `synthesizeDomainSkills` no-op in `memory-nodes.ts`) and `lib/skill-service.ts`/`lib/agent/tools/skill-tool.ts` (catalog injection into the evaluator/generate prompts + a `load_skill` tool), wires the evaluator's `skillId` for real, and builds the **Skills Runtimes** management page (replacing its "coming soon" stub).
- **Plan C5 — MCP:** `ClawMcpServer` Prisma model, port `lib/agent/{mcp-manager,mcp-config,mcp-tools}.ts`, bind MCP tools into `createClawGraph`'s `tools` array alongside the memory tools, build the **MCP Configuration** management page.
- **Plan C6 — Scheduled tasks:** a `ClawScheduledTask` model (mirroring nucleus' `ScheduledTask`/`ScheduledTaskLock`) plus a chatflow-workers job (mirroring the `agent-ops-scheduler` job family) that invokes `resolveClawRuntime` + `createClawGraph` autonomously on a cron/interval, with `autoApprove` forced on for unattended runs (no human present to approve).
- **Plan C7 — Connectors:** `ClawConnector`-style per-tenant channel config, port `lib/gateway/{adapter-registry,gateway-service,event-bus,notification-router,adapters/*}.ts`, build the **Connectors** page.
- **Fast-follow:** **Memory Runtimes** management page (browse/search/export `ClawMemory` rows — data layer already exists from Plan C2), Markdown export ported from nucleus' `lib/memory-export.ts`/`lib/skill-export.ts` patterns.
