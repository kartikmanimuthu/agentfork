/**
 * claw-deep-agent.ts — Claw's task path as a deepagents loop, replacing the
 * hand-written StateGraph in claw-graph.ts.
 *
 * Planning is `write_todos`, a tool the model reaches for when the work is
 * complex, rather than a node every turn pays for. There is no reflect/revise
 * cycle — the loop iterates on its own.
 *
 * `buildInterruptOn` is copied here from the deleted claw-agent.ts spike so
 * this file has no dependency on it (Task 9 deletes claw-agent.ts).
 *
 * Forced middleware (Task 1's `REQUIRED_MIDDLEWARE_NAMES` probe —
 * `new Set(["FilesystemMiddleware", "SubAgentMiddleware"])`): `createDeepAgent`
 * injects its own filesystem and subagent middleware UNCONDITIONALLY, with no
 * opt-out via `middleware`. `FilesystemMiddlewareOptions.backend` defaults to
 * `StateBackend` when no `backend` is supplied to `createDeepAgent` — i.e. an
 * in-memory, per-run, checkpoint-serialized store that has nothing to do with
 * Claw's DB-backed workspace files. Passing `ClawWorkspaceBackend` as `backend`
 * is therefore not optional: omitting it means every `read_file`/`write_file`
 * call the model makes routes to `StateBackend` instead of
 * `claw_workspace_files`, silently diverging from the six-file persona system.
 *
 * State schema: `createClawMemoryMiddleware` (Task 3) declares no
 * `stateSchema` of its own — its hooks read/write `memoryContext`,
 * `taskDescription`, etc. by casting `state as MemoryNodeState`, which is a
 * compile-time convenience only. deepagents' merged state is the union of the
 * top-level `stateSchema` and every middleware's own `stateSchema` (see
 * `InferAgentState` in `node_modules/langchain/dist/agents/types.d.ts`); a key
 * that appears in neither is not a tracked channel and a middleware hook's
 * update to it is not merged back into state. Declaring
 * `clawMemoryStateSchema` below and passing it as `stateSchema` to
 * `createDeepAgent` is what makes `memoryContext` and `taskDescription`
 * actually persist across turns instead of always reading back as
 * `undefined` — proven at runtime by `claw-deep-agent.test.ts`'s
 * "carries memoryContext/taskDescription..." test, not just asserted from the
 * `.d.ts`.
 */
import { z } from 'zod';
import { createDeepAgent } from 'deepagents';
import type { AnyBackendProtocol, FilesystemPermission } from 'deepagents';
import { modelCallLimitMiddleware, todoListMiddleware } from 'langchain';
import type { AgentMiddleware, WhenPredicate } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createLogger } from '@chatbot/shared';
import { classifyTool } from './tool-classifier';
import { composeIdentity, type PromptSurface } from './prompt-composer';
import {
  buildBaseIdentity, CORE_PRINCIPLES, selfAuthoringSection, onboardingSection,
  connectedCapabilitiesSection, currentTimeSection,
} from './prompt-templates';
import { slugToPath } from './workspace-backend';
import { WORKSPACE_SLUGS, type WorkspaceSlug } from '../workspace/types';
import { isPersonaUnconfigured } from '../workspace/onboarding';
import { canClawWrite, selfAuthoringMode, type SelfAuthoringMode } from '../workspace/self-authoring-policy';
import type { ApprovalMode } from '../scheduler/types';

const logger = createLogger('claw-studio:claw-deep-agent');

const DEFAULT_MODEL_CALL_LIMIT = 12;

/**
 * deepagents' own built-in tool names (`BUILTIN_TOOL_NAMES`,
 * node_modules/deepagents/dist/langsmith-*.js:5751-5754 — a local `const`, not
 * exported as a runtime value; the literal members are public only via the
 * `.d.ts`'s `FILESYSTEM_TOOL_NAMES` (agent-*.d.ts:811) and
 * `ASYNC_TASK_TOOL_NAMES` (agent-*.d.ts:2274) tuples, plus the bare `"task"`
 * subagent-delegation tool). Fix round 2, Important 5: `createDeepAgent`
 * THROWS `ConfigurationError('TOOL_NAME_COLLISION')`
 * (langsmith-*.js:5789-5790) if ANY entry in `tools` collides with this set.
 * Tenant-configured MCP/integration tool names are outside our control, and
 * "task" or "execute" are plausible real MCP tool names — without filtering,
 * one such collision would hard-fail every turn for that tenant at
 * construction, not just that one tool call.
 */
const DEEPAGENTS_BUILTIN_TOOL_NAMES = new Set([
  'ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute', // FILESYSTEM_TOOL_NAMES
  'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task', 'list_async_tasks', // ASYNC_TASK_TOOL_NAMES
  'task',
]);

/**
 * Fix round 2, Critical 2: the compiled agent's forced FilesystemMiddleware
 * always registers `write_file`/`edit_file` (and SubAgentMiddleware always
 * registers `task`) regardless of `deps.tools` — `buildInterruptOn` only ever
 * saw `deps.tools`, so these three were ABSENT from `interruptOn`, and
 * `humanInTheLoopMiddleware` auto-approves any tool absent from the map
 * (node_modules/langchain/dist/agents/middleware/hitl.js:436-442). Stand-in
 * `{ name }` objects — `buildInterruptOn` only reads `.name` — added
 * alongside `deps.tools` so these three get the same classifyTool-driven
 * verdict as any other tool, closing the "never interrupts" half of Critical 2.
 * (`write_file`/`edit_file` classify as mutative — tokenized "write file"/
 * "edit file" match tool-classifier.ts's `\bwrite\b`/`\bedit\b`; "task" alone
 * matches no verb, so it evaluates to the same non-mutative verdict a custom
 * tool literally named "task" would get — included for completeness/
 * visibility rather than to force a behavior change the classifier doesn't
 * support without editing tool-classifier.ts, which is out of scope.)
 */
const FORCED_GATE_CANDIDATES: StructuredToolInterface[] = ['write_file', 'edit_file', 'task'].map(
  (name) => ({ name }) as StructuredToolInterface,
);

/**
 * Carries the fields `createClawMemoryMiddleware`'s hooks read/write
 * (`memory-middleware.ts`'s `MemoryNodeState` cast) so they are real, tracked
 * state channels rather than reads of `undefined`. Mirrors
 * `MemoryNodeState` (`../memory/types.ts`) minus `messages` (already a
 * built-in agent-state channel) and `memoryStats`, which is declared on the
 * memory middleware's OWN stateSchema instead — that is the schema
 * `derivePrivateState` scopes its hooks to, and the hooks are the only writers.
 * `gateway/execute-run.ts`'s `deriveNodeEvents` reads it from the resulting
 * chunk to put recall/save on the run timeline.
 * Every field defaults so an agent with no memory middleware attached still
 * merges cleanly.
 */
const clawMemoryStateSchema = z.object({
  memoryContext: z.string().default(''),
  taskDescription: z.string().default(''),
  plan: z.array(z.object({ step: z.string(), status: z.string() })).default([]),
  toolResults: z
    .array(
      z.object({
        toolName: z.string(),
        output: z.string(),
        isError: z.boolean(),
        iterationIndex: z.number(),
      }),
    )
    .default([]),
  errors: z.array(z.string()).default([]),
  reflection: z.string().default(''),
  iterationCount: z.number().default(0),
  isComplete: z.boolean().default(false),
});

export interface ClawDeepAgentDeps {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  workspaceFiles?: Map<WorkspaceSlug, string>;
  /** Overrides the `agents` workspace file for this run only. */
  systemPrompt?: string;
  promptSurface?: PromptSurface;
  /** Held BY REFERENCE — file-tools populates it lazily as free-slug writes happen.
   *  NEVER copied or mutated here (fix round 2, Important 8) — `buildInterruptOn`'s
   *  `when` predicates close over this exact Set so a grant made mid-run (after
   *  this agent was constructed) is honored on the very next tool call, not just
   *  on runs built after the grant existed. */
  grantedTools?: Set<string>;
  approvalPolicy?: { mode: ApprovalMode; allowedTools?: string[] };
  autoApprove?: boolean;
  checkpointer?: BaseCheckpointSaver;
  /** Claw's workspace files, exposed to the forced FilesystemMiddleware. */
  backend?: AnyBackendProtocol;
  /** Extra middleware, e.g. the memory middleware from Task 3. */
  middleware?: AgentMiddleware[];
  /**
   * `createDeepAgent` (`CreateDeepAgentParams`,
   * node_modules/deepagents/dist/agent-*.d.ts) has no construction-time
   * model-call-count bound of its own — the closest thing, `recursionLimit`,
   * is a per-`invoke()` call option that THROWS, losing the whole turn.
   * Enforced here the same way the old spike did it: pushed into the
   * middleware array as `modelCallLimitMiddleware({ runLimit: modelCallLimit,
   * exitBehavior: 'end' })`, which ends the run gracefully with whatever was
   * accomplished instead of throwing.
   */
  modelCallLimit?: number;
  /**
   * Overrides `env.CLAW_SELF_AUTHORING` for this run — same override hook
   * `file-tools.ts`'s `FileToolsOptions.mode` already has
   * (`options.mode ?? selfAuthoringMode()`). Drives the `permissions` deny
   * rule below: expresses the free-vs-gated split from
   * `self-authoring-policy.ts` as a `FilesystemPermission`, so the forced
   * `write_file`/`edit_file` tools cannot write a slug `canClawWrite()` would
   * refuse, regardless of interrupt/approval state.
   */
  selfAuthoringMode?: SelfAuthoringMode;
  /**
   * What the tenant has connected, so the prompt can name it. Without this the
   * model sees ~100 raw tool schemas and never links "Grafana" to
   * `mcp_grafana_*` — see `connectedCapabilitiesSection`.
   */
  mcpServers?: Array<{ name: string; slug: string; description?: string | null; connected: boolean; toolCount: number; error?: string; toolNames?: string[] }>;
  integrations?: Array<{ name: string; displayName: string; description?: string }>;
  tenantId?: string;
  userId?: string;
}

/**
 * Is this exact call already granted?
 *
 * Two key shapes, because a tool name alone is not always the unit of consent.
 * `write_workspace_file` takes the slug as an ARGUMENT, so a bare-name grant
 * earned by a routine write to `user` used to exempt the very same tool when it
 * was later pointed at `soul` or `identity` — the deny rule in
 * `buildWorkspacePermissions` was the only thing stopping it, and that rule is
 * empty under CLAW_SELF_AUTHORING=all. Slug-scoped keys (`<tool>:<slug>`, seeded
 * by `file-tools.ts`) make the grant mean what it says.
 *
 * Bare-name grants still work for tools that carry no slug, so nothing else that
 * populates `grantedTools` has to change.
 */
function isGranted(granted: Set<string>, request: { toolCall: { name: string; args?: unknown } }): boolean {
  const { name, args } = request.toolCall;
  if (granted.has(name)) return true;
  const slug = (args as { slug?: unknown } | undefined)?.slug;
  return typeof slug === 'string' && granted.has(`${name}:${slug}`);
}

export function buildInterruptOn(
  tools: StructuredToolInterface[],
  opts: { granted: Set<string>; policyMode: ApprovalMode },
): Record<string, boolean | { allowedDecisions: Array<'approve' | 'edit' | 'reject'>; when?: WhenPredicate }> {
  const { granted, policyMode } = opts;
  const interruptOn: Record<string, boolean | { allowedDecisions: Array<'approve' | 'edit' | 'reject'>; when?: WhenPredicate }> = {};
  for (const tool of tools) {
    const name = tool.name;
    if (policyMode === 'all') {
      interruptOn[name] = false;
      continue;
    }
    // Classified without args — args-sensitive tools still gate, which is the
    // safe direction (over-asking, never under-asking).
    const { isMutative } = classifyTool(name);
    if (!isMutative) {
      interruptOn[name] = false;
      continue;
    }
    // Fix round 2, Important 8: `granted` is held BY REFERENCE and populated
    // LAZILY mid-run (see `ClawDeepAgentDeps.grantedTools`'s doc comment).
    // Previously this branch snapshotted `granted.has(name)` ONCE at
    // construction time — so the first free-slug write granted a tool, but a
    // SECOND call to that same tool still prompted, because the frozen
    // `{ allowedDecisions }` from construction time never re-checked. `when`
    // is evaluated by `humanInTheLoopMiddleware` on every call
    // (hitl.d.ts's `InterruptOnConfig.when`), so a grant added after this
    // agent was built is honored on the very next call to that tool.
    interruptOn[name] = {
      allowedDecisions: ['approve', 'edit', 'reject'],
      when: (request) => !isGranted(granted, request),
    };
  }
  return interruptOn;
}

/**
 * Fix round 2, Critical 2: expresses self-authoring-policy.ts's free-vs-gated
 * split as a `FilesystemPermission` deny rule, so a write to a slug
 * `canClawWrite()` would refuse is blocked at the backend/tool layer —
 * independent of `interruptOn`/approval state, and therefore not bypassable
 * by `autoApprove`/`policyMode: 'all'`/a stale grant. `mode: 'off'` denies all
 * six slugs; the default `'user'` mode denies only the three GATED slugs
 * (identity/soul/agents); `'all'` denies none (writes there still gate via
 * `interruptOn` above, since write_file/edit_file classify as mutative).
 */
function buildWorkspacePermissions(mode: SelfAuthoringMode): FilesystemPermission[] {
  const deniedPaths = WORKSPACE_SLUGS.filter((slug) => !canClawWrite(slug, mode)).map(slugToPath);
  if (deniedPaths.length === 0) return [];
  return [{ operations: ['write'], paths: deniedPaths, mode: 'deny' }];
}

// Explicit return type — binding `createTaskDescriptionMiddleware()`/
// `createClawMemoryMiddleware()` to real `stateSchema`s (fix for TS2322 in
// claw-runtime.ts/memory-middleware.ts) makes the middleware array's element
// types specific enough that the compiler can no longer print this
// function's INFERRED return type into a .d.ts without reaching into
// `@langchain/core`'s internal, hash-versioned bun store path (TS2742,
// "cannot be named ... not portable"). Naming it via `ReturnType<typeof
// createDeepAgent>` instead lets the declaration file reference the
// imported `createDeepAgent` symbolically rather than expanding its
// structure — same runtime value, just a nameable type.
export function createClawDeepAgent(deps: ClawDeepAgentDeps): ReturnType<typeof createDeepAgent> {
  try {
    const {
      model, tools = [], workspaceFiles, systemPrompt, promptSurface,
      grantedTools, approvalPolicy, autoApprove = false, checkpointer,
      backend, middleware = [], modelCallLimit = DEFAULT_MODEL_CALL_LIMIT,
      selfAuthoringMode: selfAuthoringModeOverride, mcpServers, integrations, tenantId, userId,
    } = deps;

    // Fix round 2, Important 5 — drop any tenant-configured tool whose name
    // collides with a deepagents built-in, rather than letting the whole
    // tenant's every turn hard-fail at construction (see the constant's doc
    // comment for the exact throw this avoids).
    const safeTools: StructuredToolInterface[] = [];
    for (const tool of tools) {
      if (DEEPAGENTS_BUILTIN_TOOL_NAMES.has(tool.name)) {
        logger.warn(
          { tenantId, userId, toolName: tool.name },
          '[claw-deep-agent] dropping tenant-configured tool — name collides with a deepagents built-in tool',
        );
        continue;
      }
      safeTools.push(tool);
    }

    const policyMode: ApprovalMode = autoApprove ? 'all' : (approvalPolicy?.mode ?? 'ask');
    // Fix round 2, Important 8 — NEVER mutate the caller's live `grantedTools`
    // Set (previously `approvalPolicy.allowedTools` was merged directly into
    // it, permanently leaking config-level grants into file-tools'
    // `grantedWrites`, which is held by reference and reused across runs).
    // `granted` passed to `buildInterruptOn` IS `grantedTools`, unmodified and
    // by reference, so its `when` closures observe later mid-run mutations;
    // the static, config-level allowlist is applied separately, below.
    const granted = grantedTools ?? new Set<string>();

    const files = workspaceFiles ?? new Map<WorkspaceSlug, string>();
    const composed = composeIdentity({
      files,
      surface: promptSurface ?? 'acting',
      agentsOverride: systemPrompt,
    });
    // Read from the files themselves rather than a "first turn" flag, so the
    // setup keeps offering itself until it has actually happened and stops the
    // moment either persona file is written — including by a human in Mission
    // Control, which no conversation-scoped flag would notice. See
    // workspace/onboarding.ts.
    const unconfigured = isPersonaUnconfigured(files);
    // `resolvedSelfAuthoring` is read once and used for BOTH the permission deny
    // rule and the prompt section, so the two can never disagree — a prompt that
    // tells Claw to maintain files the backend will refuse just produces failed
    // tool calls and a confused apology mid-conversation.
    const resolvedSelfAuthoring = selfAuthoringModeOverride ?? selfAuthoringMode();
    // The clock is read here, at build time, so every turn carries the time it
    // actually started rather than a value frozen when the module loaded.
    // `resolvedSelfAuthoring` gates the onboarding section for the same reason
    // it gates the self-authoring one: under 'user'/'off' the persona slugs are
    // denied by `buildWorkspacePermissions` below, so asking Claw to write them
    // would only ever produce a failed tool call.
    const capabilities = connectedCapabilitiesSection({ mcpServers, integrations });
    const prompt = `${buildBaseIdentity(null, composed)}\n${CORE_PRINCIPLES}${selfAuthoringSection(resolvedSelfAuthoring)}${onboardingSection(unconfigured, resolvedSelfAuthoring)}${capabilities}${currentTimeSection(new Date(), process.env['CLAW_TIMEZONE'] || 'UTC')}`;

    const interruptOn = buildInterruptOn([...safeTools, ...FORCED_GATE_CANDIDATES], { granted, policyMode });
    // Static, config-level allowlist — permanent for this run. Applied as a
    // flat override AFTER buildInterruptOn, and never by mutating `granted`
    // (Important 8's leak fix): a tool named here is unconditionally
    // auto-approved for this run without ever touching the caller's live Set.
    for (const name of approvalPolicy?.allowedTools ?? []) {
      interruptOn[name] = false;
    }

    const permissions = buildWorkspacePermissions(resolvedSelfAuthoring);

    // Hard ceiling that ENDS rather than throwing (see `modelCallLimit`'s doc
    // comment above) — `runLimit` bounds a single agent invocation, matching
    // the old graph's per-run MAX_REVISE_ROUNDS bound. `todoListMiddleware()`
    // (fix round 2, Important 4) restores the planner this migration is
    // supposed to trade for a tool: deepagents only wires it in for the Codex
    // harness profile (langsmith-*.js:5505-5521) — Anthropic/Bedrock models
    // get NO `write_todos` tool by default, so without this line the old
    // graph's mandatory planner node is traded for nothing at all. Both
    // always present, ahead of any caller-supplied middleware (e.g. Task 3's
    // memory middleware), so `middleware` is never empty and neither depends
    // on what deps pass in.
    const allMiddleware: AgentMiddleware[] = [
      modelCallLimitMiddleware({ runLimit: modelCallLimit, exitBehavior: 'end' }),
      todoListMiddleware(),
      ...middleware,
    ];

    logger.info(
      {
        tenantId, userId, tools: safeTools.length,
        gated: Object.values(interruptOn).filter(Boolean).length,
        policyMode, modelCallLimit, hasBackend: !!backend,
        deniedWritePaths: permissions[0]?.paths ?? [],
        // Onboarding is invisible in the transcript until Claw acts on it, so
        // log whether the section went in — "why did it not introduce itself"
        // is otherwise unanswerable after the fact.
        onboarding: unconfigured && resolvedSelfAuthoring === 'all',
        mcpConnected: (mcpServers ?? []).filter((s) => s.connected).length,
        mcpUnreachable: (mcpServers ?? []).filter((s) => !s.connected).map((s) => s.name),
        integrations: (integrations ?? []).length,
      },
      '[claw-deep-agent] building agent',
    );

    return createDeepAgent({
      model,
      tools: safeTools,
      systemPrompt: prompt,
      interruptOn,
      stateSchema: clawMemoryStateSchema,
      middleware: allMiddleware,
      ...(permissions.length ? { permissions } : {}),
      ...(backend ? { backend } : {}),
      ...(checkpointer ? { checkpointer } : {}),
    });
  } catch (err) {
    logger.error(
      { tenantId: deps.tenantId, userId: deps.userId, err },
      '[claw-deep-agent] failed to build agent',
    );
    throw err;
  }
}
