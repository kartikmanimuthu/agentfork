import type { LLMProvider } from './provider';

export async function generateEmbedding(text: string, provider: LLMProvider): Promise<number[]> {
  return provider.embed(text);
}

export async function generateEmbeddings(texts: string[], provider: LLMProvider): Promise<number[][]> {
  return provider.embedBatch(texts);
}
