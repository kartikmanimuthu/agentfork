import { embedMany, embed } from 'ai';
import { getBedrockProvider } from './bedrock-client';

const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

export async function generateEmbedding(text: string): Promise<number[]> {
  const bedrock = getBedrockProvider();
  const { embedding } = await embed({
    model: bedrock.textEmbeddingModel(EMBEDDING_MODEL),
    value: text,
  });
  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const bedrock = getBedrockProvider();
  const { embeddings } = await embedMany({
    model: bedrock.textEmbeddingModel(EMBEDDING_MODEL),
    values: texts,
  });
  return embeddings;
}
