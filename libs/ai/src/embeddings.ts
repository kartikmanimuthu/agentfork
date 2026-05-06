import type { LLMProvider } from './provider';
import { getDefaultProvider } from './provider-factory';

export async function generateEmbedding(text: string, provider?: LLMProvider): Promise<number[]> {
  return (provider ?? getDefaultProvider()).embed(text);
}

export async function generateEmbeddings(texts: string[], provider?: LLMProvider): Promise<number[][]> {
  return (provider ?? getDefaultProvider()).embedBatch(texts);
}
