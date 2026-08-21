/**
 * usage-collector.ts — keeps the token counts and model timings a turn produces.
 *
 * These numbers were always being computed. `model-factory.ts`'s
 * `createCallTelemetry` has read `tokenUsage` and measured every call's duration
 * since it was written — and passed both straight to Pino and then dropped them.
 * Nothing was persisted or returned, so the chat UI had no way to show what a
 * response cost or how long it took.
 *
 * A mutable collector rather than a return value because of where the data
 * appears: usage arrives in a LangChain callback, one per model call, deep inside
 * `graph.stream()`. A turn makes several such calls (tool round trips, subagents,
 * the reflector), and the caller that wants the total is the request handler
 * outside the whole loop. An accumulator handed down is the only seam that does
 * not thread a return value back through deepagents.
 *
 * Pure and dependency-free so the provider-shape normalisation below is testable
 * without a model, a graph, or a database.
 */

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** How many model calls the turn made — context for the token totals. */
  modelCalls: number;
  /** Summed model time. NOT wall-clock for the turn: calls can overlap (subagents),
   *  and tool execution between calls is not counted here. Response time as the user
   *  experiences it comes from the run's own createdAt→completedAt. */
  modelMs: number;
}

export interface UsageCollector {
  record(input: RawUsageInput): void;
  totals(): UsageTotals;
}

export interface RawUsageInput {
  /** LangChain's normalised shape, when the provider fills it in. */
  tokenUsage?: unknown;
  /** The message-level shape Bedrock/Anthropic use instead. */
  usageMetadata?: unknown;
  /** Wall-clock for this one model call. */
  durationMs?: number | null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Reads input/output tokens out of whichever shape the provider used.
 *
 * There is no single one. LangChain normalises some providers into
 * `llmOutput.tokenUsage` as `{ promptTokens, completionTokens }`; Bedrock and
 * Anthropic report `usage_metadata` on the message as `{ input_tokens,
 * output_tokens }`; and the self-hosted OpenAI-compatible gateway has been seen
 * using the raw OpenAI names (`prompt_tokens`/`completion_tokens`). All three are
 * accepted, because a provider that reports usage in a shape we do not read is
 * indistinguishable in the UI from one that reports none — silently zero.
 */
export function normaliseUsage(input: RawUsageInput): { inputTokens: number; outputTokens: number } {
  const usage = (input.tokenUsage ?? {}) as Record<string, unknown>;
  const meta = (input.usageMetadata ?? {}) as Record<string, unknown>;

  const inputTokens =
    num(usage['promptTokens']) ||
    num(usage['prompt_tokens']) ||
    num(usage['inputTokens']) ||
    num(usage['input_tokens']) ||
    num(meta['input_tokens']) ||
    num(meta['inputTokens']);

  const outputTokens =
    num(usage['completionTokens']) ||
    num(usage['completion_tokens']) ||
    num(usage['outputTokens']) ||
    num(usage['output_tokens']) ||
    num(meta['output_tokens']) ||
    num(meta['outputTokens']);

  return { inputTokens, outputTokens };
}

export function createUsageCollector(): UsageCollector {
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, modelCalls: 0, modelMs: 0 };

  return {
    record(input: RawUsageInput) {
      const { inputTokens, outputTokens } = normaliseUsage(input);
      totals.inputTokens += inputTokens;
      totals.outputTokens += outputTokens;
      totals.modelCalls += 1;
      totals.modelMs += num(input.durationMs);
    },
    // A copy, so a caller holding the result cannot see it change under them when
    // the turn's background tail (memory extraction) makes further model calls.
    totals: () => ({ ...totals }),
  };
}
