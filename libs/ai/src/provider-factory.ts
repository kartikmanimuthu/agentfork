import type { LLMProvider } from './provider';
import type { TenantLLMConfig } from './types';
import { getDefaultLLMConfig } from './types';
import { BedrockLLMProvider } from './providers/bedrock';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

function logFactory(message: string, data?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[provider-factory] ${message}`, data ?? '');
}

export function createLLMProvider(config?: TenantLLMConfig | null): LLMProvider {
  const effectiveConfig = config ?? getDefaultLLMConfig('bedrock');
  logFactory('Creating LLM provider', {
    provider: effectiveConfig.provider,
    chatModel: effectiveConfig.chatModel,
    baseUrl: effectiveConfig.baseUrl,
    hasApiKey: !!effectiveConfig.apiKey,
  });

  switch (effectiveConfig.provider) {
    case 'bedrock':
      return new BedrockLLMProvider(effectiveConfig);
    case 'openai':
    case 'openai_compatible':
    case 'vllm':
    case 'ollama':
    case 'anthropic':
      return new OpenAICompatibleProvider(effectiveConfig);
    default:
      throw new Error(`Unknown LLM provider: ${(effectiveConfig as any).provider}`);
  }
}

export function getDefaultProvider(): LLMProvider {
  return createLLMProvider();
}
