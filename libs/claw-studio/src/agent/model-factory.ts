import { ChatBedrockConverse } from '@langchain/aws';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ModelProfile } from '@langchain/core/language_models/profile';
import { summarizeCallShape } from './call-shape';
import { createLogger } from '@chatbot/shared';
import type { UsageCollector } from './usage-collector';

export interface ClawModelConfig {
  provider: string;
  chatModel?: string;
  region?: string;
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Collects the token counts and per-call durations this model's telemetry
   * already measures, so the turn can report them. Optional: every existing caller
   * omits it and keeps logging-only behaviour.
   */
  usageCollector?: UsageCollector;
}

const logger = createLogger('claw-studio:agent:model-factory');

const OPENAI_COMPATIBLE = new Set(['openai', 'openai_compatible', 'ollama', 'vllm', 'litellm', 'lmstudio']);

/**
 * Provider-family context-window estimates, in tokens. Ported from nucleus's
 * `PROVIDER_CONTEXT_WINDOW`, which sizes self-hosted families conservatively
 * because a gateway row says nothing about the window of the model behind it —
 * the same LiteLLM provider fronts the whole llm-powerhouse fleet.
 *
 * Unknown providers get the small default deliberately: over-budgeting a small
 * model is the failure that costs a whole turn, while under-budgeting a large
 * one only compacts sooner than strictly necessary.
 */
const PROVIDER_CONTEXT_WINDOW: Record<string, number> = {
  bedrock: 200_000,
  anthropic: 200_000,
  openai: 128_000,
  // 64k, not the 16k these families started at: measured from the actual
  // deployment rather than guessed. The llm-powerhouse llama.cpp services launch
  // with `--ctx-size 131072 --parallel 2`, and llama.cpp divides the KV cache
  // across parallel slots — so a single request gets 65536. The 16k guess
  // under-budgeted the fleet 4x and made the tool budget drop every integration
  // for no reason. Two services (bonsai-27b, nemotron-lightning) declare 65536
  // outright, so 64k is the floor across the fleet, not the ceiling of one model.
  //
  // Still a family-level estimate: a gateway row cannot tell you the window of
  // the model behind it. A deployment serving genuinely smaller models needs
  // WORKING_MEMORY_TOKEN_BUDGET set, or this map corrected.
  openai_compatible: 65_536,
  ollama: 65_536,
  vllm: 65_536,
  litellm: 65_536,
  lmstudio: 65_536,
};

/**
 * The families served from your own hardware rather than a managed endpoint.
 * Distinct from OPENAI_COMPATIBLE, which includes real OpenAI: `openai` speaks the
 * same protocol but is a managed API with managed-API latency.
 */
const SELF_HOSTED = new Set(['openai_compatible', 'ollama', 'vllm', 'litellm', 'lmstudio']);

const MANAGED_TIMEOUT_MS = 60_000;
const SELF_HOSTED_TIMEOUT_MS = 180_000;

/**
 * How long to wait for the FIRST TOKEN before calling the endpoint dead.
 *
 * Because streaming is enabled, this bounds time-to-first-token rather than total
 * generation (see the note in createClawModel), so the question it answers is "is
 * anything alive at the other end?" — and the honest answer differs by who serves
 * the model. A managed API that has produced nothing in 60s is broken. A
 * self-hosted llama.cpp server on a single GPU may still be legitimately ingesting
 * a large prompt: the llm-powerhouse fleet measured ~27s to first token on a ~21k
 * prompt, so a conversation that grows toward its compaction threshold can exceed
 * 60s of prompt processing while working perfectly well.
 *
 * Unknown providers get the tight guard: failing fast on something we cannot
 * characterise is safer than making every user wait three minutes for a typo in a
 * base URL.
 */
export function requestTimeoutFor(provider: string): number {
  return SELF_HOSTED.has(provider) ? SELF_HOSTED_TIMEOUT_MS : MANAGED_TIMEOUT_MS;
}

const DEFAULT_CONTEXT_WINDOW = 16_000;
const CONTEXT_SAFETY_MARGIN = 2_000;
const MIN_INPUT_BUDGET = 8_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * An operator-declared context window for the model actually being served, in
 * tokens — copy it straight off the server (`--ctx-size`, `--max-model-len`),
 * divided by the number of parallel slots if the server splits its KV cache.
 *
 * A SEPARATE variable from `WORKING_MEMORY_TOKEN_BUDGET` on purpose. That one
 * sizes how much recalled memory is injected; this one sizes the model's whole
 * input budget — and, through `budgetTools`, the tool-schema allowance. Sharing a
 * variable meant an operator shrinking memory recall would silently shrink the
 * schema limit too, dropping the browser, integration and web tool groups
 * wholesale, with the model left claiming it could not browse.
 */
function contextWindowOverride(): number | null {
  const raw = process.env['CLAW_MODEL_CONTEXT_WINDOW'];
  if (!raw) return null;
  const parsed = Number(raw);
  // A typo must not silently reconfigure the agent's whole tool surface.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The input-token budget this provider's model can actually accept: its context
 * window less the output reservation and a safety margin.
 *
 * This exists because deepagents cannot work it out for itself. Its
 * `computeSummarizationDefaults` uses fraction-based triggers only when the model
 * reports a profile with `maxInputTokens`, and @langchain/openai's profile getter
 * is a lookup table keyed by model id (`PROFILES[this.model] ?? {}`) — a
 * gateway-served id like `llm-powerhouse-qwen-3-8` is absent, resolves to `{}`,
 * and summarization then sizes itself with large-model fixed defaults. Against a
 * 16k window that means no compaction until far past what the model can read, so
 * a tool-heavy turn grows a prompt the gateway needs minutes to process and the
 * request timeout kills the turn.
 *
 * `CLAW_MODEL_CONTEXT_WINDOW` overrides the family estimate, which is the escape
 * hatch when a deployment serves a window the family default does not describe.
 */
export function deriveInputTokenBudget(config: ClawModelConfig): number {
  const contextWindow = contextWindowOverride() ?? PROVIDER_CONTEXT_WINDOW[config.provider] ?? DEFAULT_CONTEXT_WINDOW;
  const outputReserve = config.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(MIN_INPUT_BUDGET, contextWindow - outputReserve - CONTEXT_SAFETY_MARGIN);
}

/**
 * `ChatOpenAI` that knows its own context window.
 *
 * `profile` is a getter with no constructor option or setter, so declaring
 * `maxInputTokens` for a gateway-served model means overriding it. Doing so keeps
 * deepagents' DEFAULT summarization middleware in place and untouched — we supply
 * the fact it was missing rather than replacing its configuration, so nothing in
 * `claw-runtime.ts`'s middleware array changes and the by-name merge trap
 * documented there is never approached.
 *
 * If @langchain/openai ever renames `profile`, this override stops taking effect
 * silently rather than failing loudly — `model-factory.test.ts` asserts on
 * `model.profile.maxInputTokens` for exactly that reason.
 */
class ClawChatOpenAI extends ChatOpenAI {
  private readonly clawMaxInputTokens: number;

  constructor(fields: ConstructorParameters<typeof ChatOpenAI>[0], maxInputTokens: number) {
    super(fields);
    this.clawMaxInputTokens = maxInputTokens;
  }

  override get profile(): ModelProfile {
    return { ...super.profile, maxInputTokens: this.clawMaxInputTokens };
  }
}

/**
 * Ollama serves the OpenAI-compatible API under `/v1` while its native model
 * listing (`/api/tags`, used by discovery) sits at the host root, so a single
 * stored `baseUrl` cannot satisfy both without normalizing here. Without this,
 * a base of `https://ollama.com` POSTs to `https://ollama.com/chat/completions`
 * — a website route, not an API one — which answers with an HTML 404 that
 * LangChain reports as the misleading MODEL_NOT_FOUND.
 *
 * Duplicated from `toOllamaOpenAIBaseUrl` in @chatbot/ai rather than imported:
 * mission-control's next.config only transpiles @chatbot/claw-studio, not
 * @chatbot/ai, so importing it here would pull an untranspiled package into
 * that build.
 */
function toOllamaOpenAIBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return baseUrl;
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * Per-model-call diagnostics for the one failure that is otherwise invisible: a
 * turn that dies on `Request timed out.` tells you nothing about WHY the model
 * went quiet.
 *
 * The three numbers that distinguish the possible causes:
 *  - `ttftMs` / `streamedTokens` — whether streaming reached the wire at all. If
 *    tokens never arrive, `invoke()` is not streaming and the request timeout is
 *    still bounding total generation, not time-to-first-token.
 *  - `estFixedTokens` vs `inputBudget` — the system prompt and tool schemas ride
 *    on every call and cannot be compacted. Fixed alone near the budget means no
 *    summarization setting can rescue the call.
 *  - `estPromptTokens` — whether compaction is actually holding the total down.
 */
function createCallTelemetry(
  logger: ReturnType<typeof createLogger>,
  provider: string,
  inputBudget: number,
  /** Accumulates what these logs already measure, so a turn can report its token
   *  cost and model time instead of only writing them to stdout. */
  usage?: UsageCollector,
) {
  /**
   * Keyed by LangChain's per-call `runId`, not held as single-slot closure state.
   *
   * One handler object is shared by a model instance across every call it makes,
   * and those calls overlap: deepagents spawns subagents, and the reflector is
   * built through the same path. With one slot, a second call's start reset
   * `startedAt`, so the first call's `handleLLMEnd` reported a duration measured
   * from the wrong origin and a token count mixing both calls. These logs exist
   * specifically to diagnose timeouts, so wrong numbers here are worse than none.
   */
  const calls = new Map<string, { startedAt: number; firstTokenAt: number | null; streamedTokens: number }>();

  /** Bounds the map if a call somehow never reports an end (an aborted stream). */
  const MAX_TRACKED_CALLS = 64;

  return {
    handleChatModelStart(
      _llm: unknown,
      messages: unknown,
      runId?: string,
      _parentRunId?: string,
      extraParams?: Record<string, unknown>,
    ) {
      if (runId) {
        if (calls.size >= MAX_TRACKED_CALLS) calls.clear();
        calls.set(runId, { startedAt: Date.now(), firstTokenAt: null, streamedTokens: 0 });
      }
      const batch = (Array.isArray(messages) ? messages[0] : []) as Parameters<typeof summarizeCallShape>[0];
      const invocation = extraParams?.['invocation_params'] as { tools?: unknown[] } | undefined;
      const shape = summarizeCallShape(batch ?? [], invocation?.tools ?? []);
      logger.info(
        { provider, inputBudget, ...shape, overBudget: shape.estPromptTokens > inputBudget },
        'Model call started',
      );
    },
    handleLLMNewToken(_token: string, _idx: unknown, runId?: string) {
      const call = runId ? calls.get(runId) : undefined;
      if (!call) return;
      call.streamedTokens += 1;
      if (call.firstTokenAt === null) {
        call.firstTokenAt = Date.now();
        logger.info({ provider, ttftMs: call.firstTokenAt - call.startedAt }, 'Model produced its first token');
      }
    },
    // Signature kept structurally compatible with LangChain's
    // `BaseCallbackHandlerMethodsClass` — declaring `generations` here with our own
    // shape makes the whole handler object unassignable to `Callbacks`, so the
    // message-level usage is read via a narrow cast below instead.
    handleLLMEnd(output: { llmOutput?: { tokenUsage?: unknown } }, runId?: string) {
      const call = runId ? calls.get(runId) : undefined;
      if (runId) calls.delete(runId);
      const totalMs = call ? Date.now() - call.startedAt : null;
      const tokenUsage = output?.llmOutput?.tokenUsage;
      // Where Bedrock/Anthropic report usage instead of `llmOutput.tokenUsage`.
      const usageMetadata = (
        output as { generations?: Array<Array<{ message?: { usage_metadata?: unknown } }>> }
      )?.generations?.[0]?.[0]?.message?.usage_metadata;
      usage?.record({ tokenUsage, usageMetadata, durationMs: totalMs });
      logger.info(
        {
          provider,
          totalMs,
          ttftMs: call?.firstTokenAt == null ? null : call.firstTokenAt - call.startedAt,
          streamedTokens: call?.streamedTokens ?? null,
          usage: tokenUsage ?? usageMetadata,
        },
        'Model call finished',
      );
    },
    handleLLMError(err: unknown, runId?: string) {
      const call = runId ? calls.get(runId) : undefined;
      if (runId) calls.delete(runId);
      logger.error(
        {
          err,
          provider,
          totalMs: call ? Date.now() - call.startedAt : null,
          // null here is the tell: the call failed without ever producing a
          // token, so the wait was time-to-first-token, not slow generation.
          ttftMs: call?.firstTokenAt == null ? null : call.firstTokenAt - call.startedAt,
          streamedTokens: call?.streamedTokens ?? null,
        },
        'Model call failed',
      );
    },
  };
}

export function createClawModel(config: ClawModelConfig): BaseChatModel {
  const model = config.chatModel;
  if (!model) {
    throw new Error('createClawModel: chatModel is required on the provider config');
  }
  const maxTokens = config.maxTokens ?? 4096;

  // Bound every model call: without a timeout a stalled/unreachable provider
  // hangs the whole chat turn indefinitely (each node awaits the model). With
  // these, a stuck call fails after ~60s and surfaces as a visible error the
  // user can retry, instead of a silent freeze. maxRetries kept low so a dead
  // endpoint doesn't multiply the wait.
  //
  // What this timeout MEASURES depends on `streaming` below, which is why the two
  // belong together. The OpenAI SDK arms the timeout around `fetch` and clears it
  // in that call's `finally` (client.js `fetchWithTimeout`), and fetch settles on
  // response HEADERS. Non-streaming, a gateway sends no headers until the whole
  // completion exists, so 60s bounded TOTAL GENERATION: a long tool-heavy turn on
  // a self-hosted model exhausted all three attempts and lost the turn after ~7
  // minutes. Streaming, headers arrive with the first token, so the same 60s
  // bounds TIME TO FIRST TOKEN and stays a genuine stall guard without capping how
  // long a legitimately slow answer may take.
  const REQUEST_TIMEOUT_MS = requestTimeoutFor(config.provider);
  const MAX_RETRIES = 2;

  const inputBudget = deriveInputTokenBudget(config);
  const callbacks = [createCallTelemetry(logger, config.provider, inputBudget, config.usageCollector)];

  if (config.provider === 'bedrock') {
    return new ChatBedrockConverse({
      region: config.region,
      model,
      maxTokens,
      maxRetries: MAX_RETRIES,
      streaming: true,
      callbacks,
      // The AWS SDK's default HTTP handler has NO request timeout (0 = disabled) —
      // without this, a stalled Bedrock connection hangs the whole chat turn
      // indefinitely instead of failing after REQUEST_TIMEOUT_MS like every other
      // provider branch below already does via ChatOpenAI's `timeout` option.
      clientOptions: {
        requestHandler: {
          connectionTimeout: 10_000,
          requestTimeout: REQUEST_TIMEOUT_MS,
          throwOnRequestTimeout: true,
        },
      },
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    });
  }

  if (config.provider === 'anthropic') {
    return new ChatAnthropic({
      model,
      apiKey: config.apiKey,
      maxTokens,
      maxRetries: MAX_RETRIES,
      streaming: true,
      callbacks,
      // This branch was the one provider without a timeout, so a stalled
      // Anthropic connection hung the turn indefinitely while Bedrock and the
      // OpenAI-compatible branch both failed fast. ChatAnthropic has no
      // top-level `timeout` — it forwards clientOptions to the Anthropic SDK.
      clientOptions: { timeout: REQUEST_TIMEOUT_MS },
      ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
    });
  }

  if (OPENAI_COMPATIBLE.has(config.provider)) {
    const baseURL = config.provider === 'ollama'
      ? toOllamaOpenAIBaseUrl(config.baseUrl)
      : config.baseUrl;
    return new ClawChatOpenAI({
      model,
      maxTokens,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
      streaming: true,
      callbacks,
      configuration: { baseURL, apiKey: config.apiKey ?? 'not-needed' },
    }, inputBudget);
  }

  throw new Error(`createClawModel: unsupported provider "${config.provider}"`);
}
