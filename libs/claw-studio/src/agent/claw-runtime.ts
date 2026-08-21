import crypto from 'crypto';
import { z } from 'zod';
import { LlmProviderService, StudioService, TenantConfigService, getPrismaClient, createLogger } from '@chatbot/shared';
import type { AgentMiddleware } from 'langchain';
import { createClawModel } from './model-factory';
import { createClawDeepAgent } from './claw-deep-agent';
import { ClawWorkspaceBackend } from './workspace-backend';
import { createClawMemoryMiddleware } from '../memory/memory-middleware';
import { createMemoryRecallNode, createMemorySaveNode } from '../memory/memory-nodes';
import { createMemoryTools } from './memory-tools';
import { getCheckpointer, getMemoryStore } from './persistence';
import { createLoadSkillTool } from '../skills/skill-tool';
import { env } from '../env';
import { createMcpTools } from '../mcp/mcp-tools';
import { createIntegrationTools } from '../integrations';
import { WorkspaceFileService } from '../workspace/workspace-file-service';
import { isWorkspaceSlug } from '../workspace/types';
import { onboardingWriteGrants } from '../workspace/onboarding';
import { selfAuthoringMode } from '../workspace/self-authoring-policy';
import { createFileTools } from './file-tools';
import { createTimeTools } from './time-tools';
import { budgetTools } from './tool-budget';
import { deriveInputTokenBudget } from './model-factory';
import { createScheduleTools } from '../scheduler/schedule-tools';
import { acquireBrowserSession, holdBrowserSession, releaseBrowserSession } from './browser-session-registry';
import { createBrowserTools } from './browser-tools';
import { createWebTools } from './web-tools';
import { createScreenshotUploader } from './browsing-deps';
import { resolveSearchConfig } from '@chatbot/ai/tools/built-in-registry';
import { S3Service } from '@chatbot/shared/server';
import type { PromptSurface } from './prompt-composer';
import type { ApprovalMode } from '../scheduler/types';
import { createUsageCollector, type UsageCollector } from './usage-collector';

const logger = createLogger('claw-studio:runtime');

/**
 * Model calls one interactive chat turn may make, enforced by
 * `modelCallLimitMiddleware({ runLimit, exitBehavior: 'end' })` in
 * `claw-deep-agent.ts`. On exhaustion the run does not throw — it ends with
 * "Model call limits exceeded: run level call limit reached with N model calls"
 * as the assistant's reply.
 *
 * This was hardcoded to 10, chosen when Claw was purely conversational: 30
 * rounds of generate/revise prose on one blocking request read as a runaway
 * response. `CLAW_MAX_ITERATIONS` existed in env.ts the whole time and was
 * never read by anything, so an operator raising it saw no effect and no error.
 *
 * Browsing changes the arithmetic. Every tool round trip is one model call —
 * open_url → snapshot → click → type → snapshot → … — so 10 is spent after four
 * or five interactions with a page, and an approval interrupt does NOT reset the
 * counter (the middleware only zeroes `runModelCallCount` in `afterAgent`, which
 * has not run while the turn is paused). A browsing turn therefore shares one
 * budget across all of its approvals.
 */
const MAX_ITERATIONS = env.CLAW_MAX_ITERATIONS;

/** Gateway runs execute in a worker with no request timeout, so they get the
 *  graph's own budget rather than the chat's inline-safe one. Left as an
 *  explicit constant rather than folded into CLAW_MAX_ITERATIONS so lowering
 *  the chat budget cannot silently starve unattended runs. */
export const BACKGROUND_MAX_ITERATIONS = 30;

/**
 * How long a chat turn may keep running after its browser disconnected, before
 * it is aborted. See `CLAW_CHAT_DETACHED_MAX_MS` in env.ts for the full story —
 * in short, a reload must not lose the answer, but an abandoned turn must not
 * run unbounded either.
 */
export const CHAT_DETACHED_MAX_MS = env.CLAW_CHAT_DETACHED_MAX_MS;

export interface ClawCleanupOptions {
  /**
   * Park the browser instead of closing it, because this turn is not finished —
   * it paused at an approval gate and resumes in a later request against the
   * same page. Pass this ONLY on the interrupt path: on any other exit it leaves
   * a Chromium alive until CLAW_BROWSER_HOLD_MS elapses.
   */
  keepBrowser?: boolean;
}

export interface ClawRuntime {
  graph: ReturnType<typeof createClawDeepAgent>;
  threadId: string;
  clawId: string;
  autoApprove: boolean;
  /**
   * Token counts and model time for this turn, filled in as the graph runs. Read
   * it AFTER the turn produces its answer — see `usage-collector.ts` for why this
   * is an accumulator rather than a return value.
   */
  usage: UsageCollector;
  config: { configurable: { thread_id: string; tenant_id: string; user_id: string }; recursionLimit: number };
  /**
   * Releases everything this run holds: MCP client connections and the browser
   * session, if one was opened. Call in a finally block when the run ends.
   */
  cleanup: (opts?: ClawCleanupOptions) => Promise<void>;
  /**
   * @deprecated Alias of `cleanup`, kept so no call site can leak a Chromium
   * process by not having been migrated yet. Both names invoke the same
   * composed teardown; prefer `cleanup` in new code.
   */
  mcpCleanup: (opts?: ClawCleanupOptions) => Promise<void>;
}

/**
 * LangGraph's `recursionLimit` counts every individual node execution (a
 * "step"), not the graph's own `maxIterations` loop counter — one logical
 * generate/tool-call round is 2+ steps (generate, tools), plus memory_recall,
 * evaluator, planner, reflect, revise, final, memory_save on top. With
 * LangGraph's default limit of 25, even the chat-safe MAX_ITERATIONS=10 budget
 * can exceed it well before our own reflect/final wind-down ever gets a
 * chance to run, surfacing as an uncaught GraphRecursionError instead of a
 * normal (if truncated) answer. Size it generously off maxIterations instead
 * of trusting the library default.
 */
function recursionLimitFor(maxIterations: number): number {
  return maxIterations * 3 + 20;
}

/**
 * `createClawMemoryMiddleware`'s hooks (Task 3) read `state.taskDescription`
 * (memorySaveNode, memory-nodes.ts:290/293) but nothing writes it — the old
 * `claw-graph.ts` plannerNode derived it fresh every turn from the last
 * message on state (claw-graph.ts:431-434); deepagents has no equivalent node,
 * so this middleware reproduces that exact derivation as a `beforeAgent` hook.
 * `beforeAgent` fires once per `invoke()`/`stream()` call — i.e. once per
 * incoming run, matching the cadence `plannerNode` ran at (once per new human
 * turn) rather than `beforeModel`'s once-per-model-call cadence, which would
 * be needlessly re-derived multiple times per turn for the same answer.
 * `messages` is always part of the built-in agent state (available with no
 * `stateSchema` declared here — see `derivePrivateState` in
 * `node_modules/langchain/dist/agents/nodes/utils.cjs`), and `taskDescription`
 * is already a channel on the top-level `stateSchema` `createClawDeepAgent`
 * declares (`clawMemoryStateSchema`), so writing it from a middleware with no
 * `stateSchema` of its own reaches the same channel `memorySaveNode` reads —
 * verified in `claw-runtime.test.ts`'s "writes taskDescription onto the final
 * state" test, which runs a real deepagents agent (FakeListChatModel, no
 * network) end to end rather than only asserting the value was passed in.
 * Exported so that test can build the exact middleware this module wires in,
 * rather than a hand-copied stand-in that could silently drift from it.
 *
 * `stateSchema` below exists for the TYPE CHECKER only, not runtime behaviour:
 * `AgentMiddleware`'s bare (ungenericised) type defaults every type param to
 * `any`, which resolves `beforeAgent`'s expected return type to
 * `Partial<{}>` with an index signature of `undefined` — any concrete key
 * (`taskDescription: string`) then fails to typecheck. Declaring the field
 * here ties the generic to a real shape so the return type is inferred
 * correctly. It changes nothing at runtime: `derivePrivateState`
 * (`node_modules/langchain/dist/agents/nodes/utils.cjs:48`) always merges in
 * `messages`/`structuredResponse` regardless of a custom `stateSchema`, and
 * the write still lands on the same top-level `taskDescription` channel
 * `createClawDeepAgent`'s `clawMemoryStateSchema` already declares — the
 * exact mechanism `memory-middleware.ts`'s `memoryMiddlewareStateSchema`
 * already relies on for its own `taskDescription` field, so this mirrors an
 * established, tested pattern rather than introducing a new one.
 */
const taskDescriptionStateSchema = z.object({
  taskDescription: z.string().default(''),
});

export function createTaskDescriptionMiddleware(): AgentMiddleware<typeof taskDescriptionStateSchema> {
  return {
    name: 'clawTaskDescription',
    stateSchema: taskDescriptionStateSchema,
    async beforeAgent(state: unknown) {
      try {
        const { messages } = state as { messages?: Array<{ content: unknown }> };
        const last = messages?.[messages.length - 1];
        if (!last) return undefined;
        const taskDescription = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
        return { taskDescription };
      } catch (err) {
        logger.warn({ err }, '[claw-runtime] failed to derive taskDescription from incoming messages');
        return undefined;
      }
    },
  };
}

/**
 * Phase 1 keeps this simple: one conversation thread per Claw (matches the
 * "one Claw per Studio" gating already used elsewhere). Finds the existing
 * thread or creates one on first use.
 */
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

export interface ClawRuntimeOverrides {
  /** Replaces the Claw's saved system prompt for this run only — never written back. */
  systemPrompt?: string;
  /** Swaps which tenant LlmProvider config is loaded, instead of claw.providerModelId. */
  providerModelId?: string;
  /**
   * Picks one model from WITHIN the resolved provider, instead of its saved
   * `chatModel`.
   *
   * A provider is a set of credentials and an endpoint, not a single model —
   * the self-hosted LiteLLM gateway serves the whole llm-powerhouse fleet
   * (gpt-oss-20b, nemotron-lightning, muse-glimmer-30b, qwen-3-6 …) behind one
   * provider row, and `LlmProvider.models` already stores that list. Without
   * this, switching model meant editing the provider's saved `chatModel` in
   * Settings, which changes it for every surface at once.
   */
  chatModel?: string;
  /** Merged onto the resolved LlmProvider config before createClawModel(). */
  temperature?: number;
  maxTokens?: number;
  /** Replaces the Claw's saved autoApprove for this run only — never written back. */
  autoApprove?: boolean;
}

export interface ResolveClawRuntimeInput {
  tenantId: string;
  /**
   * Overrides the checkpoint thread. Gateway runs pass their own per-run thread
   * so a Slack-triggered task and the chat UI don't share one checkpoint —
   * concurrent runs on a single thread overwrite each other's state. The
   * Playground does the same, one thread per saved ClawPlaygroundSession.
   */
  threadId?: string;
  /** Defaults to the chat-safe inline budget; see BACKGROUND_MAX_ITERATIONS. */
  maxIterations?: number;
  /** Scheduled runs pass 'scheduled' so the HEARTBEAT file is injected. Defaults to 'acting'. */
  promptSurface?: PromptSurface;
  /** Stamped onto any workspace-file revision Claw writes during this run. */
  sourceRunId?: string;
  /** Least-privilege gate control. Scheduled runs pass their task's policy; chat
   *  omits it and keeps today's "ask about every mutative tool" behaviour. */
  approvalPolicy?: { mode: ApprovalMode; allowedTools?: string[] };
  /** Playground-only: per-run config overrides, applied on top of the Claw's saved config. */
  overrides?: ClawRuntimeOverrides;
}

/**
 * Resolves the tenant's Claw, its conversation thread, and a fully wired
 * (model + memory tools + checkpointer + store) compiled executor graph.
 * Replaces Plan C1's resolveClawGraph — the graph is now the real multi-node
 * executor topology (Plan C3), not the single-node stub.
 */
export async function resolveClawRuntime(input: ResolveClawRuntimeInput): Promise<ClawRuntime> {
  const {
    tenantId, threadId: threadIdOverride, maxIterations = MAX_ITERATIONS, overrides,
    promptSurface, sourceRunId, approvalPolicy,
  } = input;
  const db = getPrismaClient();

  try {
    // One studio per tenant is the invariant: an additional Claw Studio account
    // gets its own tenant (StudioService.createAccountForUser), precisely so
    // memories, providers, skills and scheduled tasks — all keyed on tenantId —
    // stay isolated between a user's accounts. `orderBy createdAt` only makes
    // the result deterministic if that invariant is ever violated, so a stray
    // second studio cannot make which Claw answers depend on row order.
    let clawStudio = await db.clawStudio.findFirst({ where: { tenantId }, include: { claws: true }, orderBy: { createdAt: 'asc' } });
    let claw = clawStudio?.claws[0];
    if (!claw) {
      // No login/provisioning step exists anymore (Mission Control trusts the
      // web-ui session), so provision the tenant's Claw on first access. The
      // studioId/passwordHash provision() generates are vestigial now, but keep
      // the NOT NULL column satisfied so no schema migration is needed.
      logger.info({ tenantId }, 'No Claw for tenant — auto-provisioning on first access');
      try {
        await new StudioService(tenantId, db).provision();
      } catch (error) {
        // provision() throws if a studio already exists — e.g. a concurrent
        // first-hit won the per-tenant advisory lock, or the tenantId is invalid
        // (FK violation). Either way, re-fetch and let the guard below decide.
        logger.warn({ tenantId, error }, 'Auto-provision did not complete — re-checking');
      }
      clawStudio = await db.clawStudio.findFirst({ where: { tenantId }, include: { claws: true }, orderBy: { createdAt: 'asc' } });
      claw = clawStudio?.claws[0];
      if (!claw) {
        throw new Error('No Claw provisioned for this tenant');
      }
    }

    const providerService = new LlmProviderService(tenantId);
    const providerModelId = overrides?.providerModelId ?? claw.providerModelId;
    const baseConfig = providerModelId
      ? await providerService.getConfigById(providerModelId)
      : await providerService.getDefaultConfig();
    if (!baseConfig) {
      throw new Error('No LLM provider configured for this tenant');
    }
    // Playground-only overrides layered on top of the resolved provider config —
    // never persisted back to LlmProvider or the Claw row.
    // The model pinned on the Claw itself, stored in `settings` because a
    // provider serves many models and `claw.providerModelId` only names the
    // provider. Read here rather than only in the chat route so a scheduled run,
    // a gateway run and the Playground all answer on the same model the user
    // last chose, instead of silently reverting to the provider's saved default.
    const pinnedChatModel = (claw.settings as { chatModel?: unknown } | null)?.chatModel;
    const resolvedChatModel =
      overrides?.chatModel ?? (typeof pinnedChatModel === 'string' ? pinnedChatModel : undefined);

    const config = {
      ...baseConfig,
      // Same shape as `reflectorModel` below, which already swaps chatModel on a
      // copy of the resolved config rather than touching the provider row.
      ...(resolvedChatModel ? { chatModel: resolvedChatModel } : {}),
      ...(overrides?.temperature !== undefined ? { temperature: overrides.temperature } : {}),
      ...(overrides?.maxTokens !== undefined ? { maxTokens: overrides.maxTokens } : {}),
    };

    // One per resolved runtime, i.e. one per request. A turn that pauses for
    // approval resumes in a LATER request with a fresh collector, so its usage
    // covers that leg only — the run's stored total is overwritten per leg rather
    // than summed across them, which matches how the answer itself is recorded.
    const usageCollector = createUsageCollector();
    const model = createClawModel({ ...config, usageCollector });
    // Internal classification/critique calls (evaluator, reflect, memory
    // extraction) run on every turn and never produce text the user reads, so
    // they don't need the full-size chat model. Same provider and credentials,
    // cheaper model id. Falls back to `model` when unconfigured, which is the
    // behaviour every deployment has today.
    const reflectorModel = env.CLAW_REFLECTOR_MODEL
      ? createClawModel({ ...config, chatModel: env.CLAW_REFLECTOR_MODEL })
      : undefined;
    // A gateway run owns its thread outright, so there is no ClawConversation row
    // to find or create for it.
    const threadId = threadIdOverride ?? (await getOrCreateClawConversation(claw.id)).threadId;
    const [checkpointer, store] = await Promise.all([
      getCheckpointer(),
      getMemoryStore().catch((error) => {
        logger.warn({ error, tenantId }, 'Memory store unavailable — continuing without long-term memory');
        return null;
      }),
    ]);
    // `mcpServers` carries the per-server outcome, failures included: a registered
    // server that cannot be reached contributes no tools, and without knowing that
    // the model cannot tell "no Grafana" from "Grafana is down" — it answered the
    // first by browsing the web. See connectedCapabilitiesSection.
    const { tools: mcpTools, servers: mcpServers, cleanup: mcpCleanup } = await createMcpTools(tenantId);
    const { tools: integrationTools, connected: connectedIntegrations } = await createIntegrationTools(tenantId);

    // Seed-then-read so an existing tenant self-heals on first access, matching
    // how this function already auto-provisions a missing Claw above.
    const workspace = new WorkspaceFileService(tenantId, claw.id, db);
    await workspace.seed();
    await workspace.reseedUnedited();
    const workspaceFiles = await workspace.asMap();

    // Reuses the WorkspaceFileService above rather than opening a second one.
    const fileTools = createFileTools(tenantId, claw.id, { service: workspace, sourceRunId });

    // First-run setup writes skip the approval gate, and only while there is
    // nothing yet to protect — see `onboardingWriteGrants` for why that is safe
    // and why it cannot outlive the setup.
    //
    // Added to fileTools' own Set, which is constructed a line above and owned
    // outright here. `createClawDeepAgent` must never mutate it (it holds the
    // caller's Set by reference so live mid-run grants are honoured), so the
    // seeding belongs at the owner.
    //
    // `selfAuthoringMode()` bare, matching what `createClawDeepAgent` resolves
    // to for this call: this function passes it no `selfAuthoringMode` override,
    // so its `selfAuthoringModeOverride ?? selfAuthoringMode()` is the same
    // value. Anything that starts passing one here must pass it to both, or the
    // grant and the prompt section stop agreeing about whether these writes are
    // possible.
    const onboardingGrants = onboardingWriteGrants(workspaceFiles, selfAuthoringMode());
    for (const key of onboardingGrants) fileTools.grantedWrites.add(key);
    if (onboardingGrants.length) {
      logger.info(
        { tenantId, clawId: claw.id, grants: onboardingGrants },
        'Persona unconfigured — granting first-run setup writes without approval',
      );
    }
    // Claw had no web access at all before this — buildBuiltInTools is reachable
    // only from the two web-ui routes, never from here.
    const tenantConfig = new TenantConfigService(tenantId);
    const webTools = await createWebTools(tenantId, {
      resolveSearchConfig: (id) => resolveSearchConfig(id, { configResolver: tenantConfig }),
    });

    // Keyed by thread, NOT constructed per call: this function runs once per
    // incoming request, and a browsing turn spans several of them because every
    // page interaction pauses for approval. A fresh session per request tore
    // down the loaded page between the approval prompt and the approved click —
    // see browser-session-registry.ts. Nothing is launched here either way; the
    // session opens Chromium lazily on the first browser_* call, so a run that
    // never browses still pays nothing.
    const browserSessionKey = `${tenantId}:${threadId}`;
    const browsing =
      env.CLAW_BROWSER_ENABLED === 'true'
        ? createBrowserTools({
            session: acquireBrowserSession(browserSessionKey, {
              tenantId,
              clawId: claw.id,
              runId: sourceRunId,
              navTimeoutMs: env.CLAW_BROWSER_NAV_TIMEOUT_MS,
              sessionMaxMs: env.CLAW_BROWSER_SESSION_MAX_MS,
              idleMs: env.CLAW_BROWSER_IDLE_MS,
              holdMs: env.CLAW_BROWSER_HOLD_MS,
              maxSessions: env.CLAW_BROWSER_MAX_SESSIONS,
            }),
            tenantId,
            clawId: claw.id,
            // Guarded rather than cast: the model supplies this slug, and
            // asMap() is keyed by WorkspaceSlug.
            readWorkspaceFile: async (slug) =>
              isWorkspaceSlug(slug) ? ((await workspace.asMap()).get(slug) ?? null) : null,
            uploadScreenshot: createScreenshotUploader({
              tenantId,
              clawId: claw.id,
              runId: sourceRunId,
              s3: new S3Service(),
            }),
          })
        : { tools: [], cleanup: async () => undefined };

    const assembledTools = [
      ...createTimeTools(),
      ...createMemoryTools(tenantId, claw.id),
      createLoadSkillTool(tenantId),
      ...fileTools.tools,
      ...createScheduleTools(tenantId),
      ...webTools,
      ...browsing.tools,
      ...mcpTools,
      ...integrationTools,
    ];

    // Tool schemas are resent on every model call and are NOT message history, so
    // summarization can never shrink them. A tenant with this many integrations
    // connected assembles 102 tools whose schemas serialize to ~19k tokens — more
    // than a 16k-window self-hosted model can hold before a single message. Trim
    // to what the model can actually read, loudly.
    const budget = budgetTools(assembledTools, { inputBudget: deriveInputTokenBudget(config) });
    const tools = budget.tools;

    logger.info(
      {
        tenantId, clawId: claw.id, threadId, provider: config.provider, model: config.chatModel,
        autoApprove: claw.autoApprove, workspaceFiles: workspaceFiles.size,
        tools: tools.length, toolsAssembled: assembledTools.length, toolsDropped: budget.dropped.length,
        schemaTokens: budget.schemaTokensAfter, schemaLimitTokens: budget.limitTokens,
      },
      'Resolved Claw runtime',
    );

    // reflectorModel no longer reaches the agent directly — it flows only into
    // memoryDeps, below, for the (cheaper, non-user-facing) recall relevance
    // filter and save-time extraction. Skills reach the model through
    // createLoadSkillTool (already in `tools`), not a passed-in content map.
    // `liveCapabilities` is what stops a rule learned during an outage from
    // outliving it. Built from `tools` (post-budget, so a trimmed-away tool is
    // correctly absent) and the servers that actually connected this turn — see
    // `live-capability-gate.ts` for the run where two such rules produced a
    // credentials request instead of the tool call the user asked for.
    const memoryDeps = {
      reflectorModel: reflectorModel ?? model,
      tenantId,
      userId: claw.id,
      store,
      liveCapabilities: {
        toolNames: tools.map((t) => t.name),
        servers: mcpServers.filter((s) => s.connected && s.toolCount > 0).map((s) => ({ name: s.name, slug: s.slug })),
      },
    };

    const graph = createClawDeepAgent({
      model,
      systemPrompt: overrides?.systemPrompt ?? claw.systemPrompt ?? undefined,
      tools,
      tenantId,
      userId: claw.id,
      checkpointer,
      autoApprove: overrides?.autoApprove ?? claw.autoApprove,
      workspaceFiles,
      promptSurface,
      // Named in the prompt so the model links a question about Grafana to the
      // `mcp_grafana_*` tools rather than improvising.
      mcpServers,
      integrations: connectedIntegrations,
      grantedTools: fileTools.grantedWrites,
      approvalPolicy,
      // Load-bearing: omitting this silently routes every read_file/write_file
      // call to deepagents' default in-memory StateBackend instead of Claw's
      // six DB-backed workspace rows, with no error anywhere (see
      // workspace-backend.ts's and claw-deep-agent.ts's module doc comments).
      backend: new ClawWorkspaceBackend(workspace, { sourceRunId }),
      middleware: [
        createTaskDescriptionMiddleware(),
        createClawMemoryMiddleware({
          recallNode: createMemoryRecallNode(memoryDeps),
          saveNode: createMemorySaveNode(memoryDeps),
        }),
        // DO NOT add createSummarizationMiddleware here. createDeepAgent
        // already installs createSummarizationMiddleware({ backend })
        // unconditionally, and deepagents merges the middleware stack BY
        // NAME — a second entry here would REPLACE the default one with a
        // copy that carries no `backend`, silently unwiring it.
      ],
      modelCallLimit: maxIterations,
    });

    // One teardown for the whole run. Neither half may prevent the other from
    // running: an MCP disconnect that throws must not leave Chromium alive.
    //
    // `keepBrowser` is for the one case where the turn is not over: it paused at
    // an approval gate and will resume in a later request, on the page the human
    // is deciding about. MCP clients are reconnected by the next
    // `resolveClawRuntime` and so are always dropped here; the browser is parked
    // instead, bounded by CLAW_BROWSER_HOLD_MS.
    const cleanup = async (opts: ClawCleanupOptions = {}) => {
      await Promise.allSettled([
        mcpCleanup(),
        opts.keepBrowser ? Promise.resolve(holdBrowserSession(browserSessionKey)) : releaseBrowserSession(browserSessionKey),
      ]);
    };

    return {
      graph,
      threadId,
      clawId: claw.id,
      autoApprove: claw.autoApprove,
      usage: usageCollector,
      config: {
        configurable: { thread_id: threadId, tenant_id: tenantId, user_id: claw.id },
        recursionLimit: recursionLimitFor(maxIterations),
      },
      cleanup,
      // Same function, not a second one — see ClawRuntime.mcpCleanup.
      mcpCleanup: cleanup,
    };
  } catch (error) {
    logger.error({ error, tenantId }, 'Failed to resolve Claw runtime');
    throw error;
  }
}

export interface ClawHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

function historyText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .join('');
  }
  return '';
}

/**
 * Reads the tenant's saved conversation from the checkpointer and reconstructs
 * the VISIBLE chat — the user's messages and Claw's final answers only. The
 * persisted thread also holds internal machinery (planner/reflection markers,
 * tool calls, intermediate generate steps); those are filtered out, and for each
 * turn only the last non-internal assistant message (the `final` answer, or a
 * clarify question) is kept — mirroring what the chat actually streamed live.
 * Reads the checkpoint directly (no graph build / MCP connect) so it stays cheap.
 */
export async function getClawHistory(tenantId: string): Promise<ClawHistoryMessage[]> {
  const db = getPrismaClient();
  try {
    const clawStudio = await db.clawStudio.findFirst({ where: { tenantId }, include: { claws: true }, orderBy: { createdAt: 'asc' } });
    const claw = clawStudio?.claws[0];
    if (!claw) return [];
    const conv = await db.clawConversation.findFirst({ where: { clawId: claw.id } });
    if (!conv) return [];

    const checkpointer = await getCheckpointer();
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: conv.threadId } });
    const raw = ((tuple?.checkpoint?.channel_values as { messages?: unknown[] } | undefined)?.messages ?? []) as Array<{
      _getType?: () => string;
      type?: string;
      content?: unknown;
      tool_calls?: unknown[];
    }>;

    const out: ClawHistoryMessage[] = [];
    let pendingAssistant: string | null = null;
    const flush = () => {
      if (pendingAssistant && pendingAssistant.trim()) out.push({ role: 'assistant', content: pendingAssistant });
      pendingAssistant = null;
    };

    for (const m of raw) {
      const type = typeof m?._getType === 'function' ? m._getType() : m?.type;
      const text = historyText(m?.content);
      if (type === 'human') {
        flush();
        if (text.trim()) out.push({ role: 'user', content: text });
      } else if (type === 'ai') {
        if (Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) continue; // tool-call step
        if (!text.trim()) continue;
        if (text.startsWith('Plan:') || text.startsWith('Reflection:')) continue; // internal markers
        pendingAssistant = text; // keep only the last per turn → the final answer
      }
      // 'tool' / 'system' messages are internal — skipped.
    }
    flush();
    return out;
  } catch (error) {
    logger.error({ error, tenantId }, 'Failed to load Claw history');
    return [];
  }
}
