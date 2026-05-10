import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => {
    const provider = (model: string) => ({ modelId: model });
    provider.textEmbeddingModel = (model: string) => ({ modelId: model, type: 'embedding' });
    return provider;
  }),
}));

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn(() => vi.fn(() => Promise.resolve({
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  }))),
}));

describe('bedrock-client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('DEFAULT_MODEL is set to Claude Sonnet', async () => {
    const { DEFAULT_MODEL } = await import('./bedrock-client');
    expect(DEFAULT_MODEL).toBe('anthropic.claude-sonnet-4-20250514-v1:0');
  });

  it('getBedrockProvider returns a provider', async () => {
    const { getBedrockProvider } = await import('./bedrock-client');
    const provider = getBedrockProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('getBedrockProvider returns the same instance on repeated calls', async () => {
    const { getBedrockProvider } = await import('./bedrock-client');
    const a = getBedrockProvider();
    const b = getBedrockProvider();
    expect(a).toBe(b);
  });

  it('provider can create a model reference', async () => {
    const { getBedrockProvider } = await import('./bedrock-client');
    const provider = getBedrockProvider();
    const model = provider('anthropic.claude-sonnet-4-20250514-v1:0');
    expect(model).toEqual({ modelId: 'anthropic.claude-sonnet-4-20250514-v1:0' });
  });
});
