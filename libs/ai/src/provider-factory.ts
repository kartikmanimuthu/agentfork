import type { LLMProvider } from './provider';
import type { TenantLLMConfig } from './types';
import { getDefaultLLMConfig } from './types';
import { BedrockLLMProvider } from './providers/bedrock';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

export function createLLMProvider(config?: TenantLLMConfig | null): LLMProvider {
  const effectiveConfig = config ?? getDefaultLLMConfig('bedrock');

  switch (effectiveConfig.provider) {
    case 'bedrock':
      return new BedrockLLMProvider(effectiveConfig);
    case 'openai':
      return new OpenAICompatibleProvider(effectiveConfig);
    default:
      throw new Error(`Unknown LLM provider: ${(effectiveConfig as any).provider}`);
  }
}

export function getDefaultProvider(): LLMProvider {
  return new BedrockLLMProvider(getDefaultLLMConfig('bedrock'));
}
