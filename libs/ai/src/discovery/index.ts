import type { ModelDiscovery } from './types';
import { BedrockModelDiscovery } from './bedrock';
import { OpenAIModelDiscovery } from './openai';
import { AnthropicModelDiscovery } from './anthropic';
import { OllamaModelDiscovery } from './ollama';
import { VllmModelDiscovery } from './vllm';

function logDiscovery(message: string, data?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[discovery:factory] ${message}`, data ?? '');
}

type ProviderType = 'BEDROCK' | 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'VLLM' | 'OPENAI_COMPATIBLE';

export function createDiscovery(providerType: ProviderType): ModelDiscovery {
  logDiscovery('Selecting discovery implementation', { providerType });
  switch (providerType) {
    case 'BEDROCK':
      return new BedrockModelDiscovery();
    case 'OPENAI':
      return new OpenAIModelDiscovery();
    case 'ANTHROPIC':
      return new AnthropicModelDiscovery();
    case 'OLLAMA':
      return new OllamaModelDiscovery();
    case 'VLLM':
      return new VllmModelDiscovery();
    case 'OPENAI_COMPATIBLE':
      return new OpenAIModelDiscovery();
    default:
      throw new Error(`Unsupported provider type for discovery: ${providerType}`);
  }
}

export type { DiscoveredModel, ModelCapability, ModelDiscovery } from './types';
