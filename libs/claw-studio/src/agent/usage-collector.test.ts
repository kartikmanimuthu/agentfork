import { describe, it, expect } from 'vitest';
import { createUsageCollector, normaliseUsage } from './usage-collector';

describe('normaliseUsage', () => {
  // LangChain's normalised shape.
  it('reads promptTokens/completionTokens', () => {
    expect(normaliseUsage({ tokenUsage: { promptTokens: 120, completionTokens: 45 } })).toEqual({
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  // The raw OpenAI names, as seen from the self-hosted gateway.
  it('reads snake_case prompt_tokens/completion_tokens', () => {
    expect(normaliseUsage({ tokenUsage: { prompt_tokens: 7, completion_tokens: 3 } })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    });
  });

  // Where Bedrock and Anthropic put it instead — on the message, not llmOutput.
  it('reads usage_metadata input_tokens/output_tokens', () => {
    expect(normaliseUsage({ usageMetadata: { input_tokens: 900, output_tokens: 210 } })).toEqual({
      inputTokens: 900,
      outputTokens: 210,
    });
  });

  it('prefers tokenUsage when a provider reports both', () => {
    expect(
      normaliseUsage({
        tokenUsage: { promptTokens: 1, completionTokens: 2 },
        usageMetadata: { input_tokens: 999, output_tokens: 999 },
      }),
    ).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  // A provider reporting nothing must read as zero rather than NaN — the UI hides
  // zero, but NaN would render as a broken label.
  it('returns zeros for a provider that reports no usage', () => {
    for (const input of [{}, { tokenUsage: null }, { tokenUsage: {} }, { usageMetadata: undefined }]) {
      expect(normaliseUsage(input)).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
  });

  it('ignores values that are not finite non-negative numbers', () => {
    expect(
      normaliseUsage({ tokenUsage: { promptTokens: -5, completionTokens: 'lots' } }),
    ).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(normaliseUsage({ tokenUsage: { promptTokens: NaN, completionTokens: Infinity } })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});

describe('createUsageCollector', () => {
  it('starts at zero', () => {
    expect(createUsageCollector().totals()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      modelMs: 0,
    });
  });

  // A turn makes several model calls — tool round trips, subagents — and the whole
  // point of an accumulator is that the caller outside the loop sees the sum.
  it('sums across every model call in a turn', () => {
    const usage = createUsageCollector();
    usage.record({ tokenUsage: { promptTokens: 100, completionTokens: 20 }, durationMs: 800 });
    usage.record({ usageMetadata: { input_tokens: 250, output_tokens: 60 }, durationMs: 1_200 });
    usage.record({ tokenUsage: { promptTokens: 50, completionTokens: 10 }, durationMs: 400 });

    expect(usage.totals()).toEqual({
      inputTokens: 400,
      outputTokens: 90,
      modelCalls: 3,
      modelMs: 2_400,
    });
  });

  // A call still counts even when the provider reports no tokens, or the duration
  // could not be measured — otherwise modelCalls would silently understate the turn.
  it('counts a call with no usage and no duration', () => {
    const usage = createUsageCollector();
    usage.record({ durationMs: null });
    expect(usage.totals()).toEqual({ inputTokens: 0, outputTokens: 0, modelCalls: 1, modelMs: 0 });
  });

  // The chat route reads totals when the answer is ready, but the turn's background
  // tail (memory extraction) keeps making calls afterwards. A snapshot must not
  // change underneath whatever was already persisted.
  it('returns a snapshot, not a live view', () => {
    const usage = createUsageCollector();
    usage.record({ tokenUsage: { promptTokens: 10, completionTokens: 5 }, durationMs: 100 });
    const snapshot = usage.totals();
    usage.record({ tokenUsage: { promptTokens: 999, completionTokens: 999 }, durationMs: 999 });

    expect(snapshot).toEqual({ inputTokens: 10, outputTokens: 5, modelCalls: 1, modelMs: 100 });
    expect(usage.totals().inputTokens).toBe(1_009);
  });
});
