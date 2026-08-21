import { describe, it, expect } from 'vitest';
import { CreateLlmProviderSchema, ProviderTypeEnum } from './llm-provider';

describe('ProviderTypeEnum', () => {
  it('accepts LITELLM as a valid provider type', () => {
    expect(ProviderTypeEnum.safeParse('LITELLM').success).toBe(true);
  });
});

describe('CreateLlmProviderSchema', () => {
  it('accepts a LITELLM provider with an optional maxBudgetUsd', () => {
    const result = CreateLlmProviderSchema.safeParse({
      name: 'LiteLLM Gateway',
      providerType: 'LITELLM',
      credentials: {},
      maxBudgetUsd: 50,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a LITELLM provider with no maxBudgetUsd (unlimited)', () => {
    const result = CreateLlmProviderSchema.safeParse({
      name: 'LiteLLM Gateway',
      providerType: 'LITELLM',
      credentials: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative maxBudgetUsd', () => {
    const result = CreateLlmProviderSchema.safeParse({
      name: 'LiteLLM Gateway',
      providerType: 'LITELLM',
      credentials: {},
      maxBudgetUsd: -10,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid models array', () => {
    const result = CreateLlmProviderSchema.safeParse({
      name: 'LiteLLM Gateway',
      providerType: 'LITELLM',
      credentials: {},
      models: [{ id: 'x', name: 'x', capabilities: ['chat'] }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a models array with entries missing required fields', () => {
    const result = CreateLlmProviderSchema.safeParse({
      name: 'LiteLLM Gateway',
      providerType: 'LITELLM',
      credentials: {},
      models: [{ id: 'x' }],
    });
    expect(result.success).toBe(false);
  });
});
