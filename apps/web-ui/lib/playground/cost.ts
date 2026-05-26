import type { CostEstimate } from './types';

interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
  thinkingPer1k?: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'anthropic.claude-3-opus-20240229-v1:0': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'anthropic.claude-sonnet-4-20250514-v1:0': { inputPer1k: 0.003, outputPer1k: 0.015 },
};

const FALLBACK_PRICING: ModelPricing = { inputPer1k: 0.003, outputPer1k: 0.015 };

export function calculateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number }
): CostEstimate {
  const pricing = DEFAULT_PRICING[model] ?? FALLBACK_PRICING;
  const input = (usage.inputTokens / 1000) * pricing.inputPer1k;
  const output = (usage.outputTokens / 1000) * pricing.outputPer1k;
  const thinking = usage.thinkingTokens
    ? (usage.thinkingTokens / 1000) * (pricing.thinkingPer1k ?? pricing.outputPer1k)
    : 0;
  return { input, output, thinking, total: input + output + thinking };
}
