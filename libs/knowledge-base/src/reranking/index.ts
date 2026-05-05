import type { RetrievalResult, Reranker } from '../types';

// ─── Cohere reranker ──────────────────────────────────────────────────────────

export class CohereReranker implements Reranker {
  constructor(private readonly model = 'rerank-english-v3.0') {}

  async rerank(query: string, chunks: RetrievalResult[], topK: number): Promise<RetrievalResult[]> {
    const apiKey = process.env['COHERE_API_KEY'];
    if (!apiKey) throw new Error('COHERE_API_KEY environment variable is required');

    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: chunks.map((c) => c.content),
        top_n: topK,
        return_documents: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere rerank failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map(({ index, relevance_score }) => ({
      ...chunks[index],
      score: relevance_score,
    }));
  }
}

// ─── Cross-encoder reranker (local via Ollama) ────────────────────────────────

export class CrossEncoderReranker implements Reranker {
  constructor(
    private readonly model = 'cross-encoder/ms-marco-MiniLM-L-6-v2',
    private readonly baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
  ) {}

  async rerank(query: string, chunks: RetrievalResult[], topK: number): Promise<RetrievalResult[]> {
    // Score each chunk by asking the model to score query-document relevance
    const scored = await Promise.all(
      chunks.map(async (chunk, i) => {
        try {
          const res = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.model,
              prompt: `Query: ${query}\nDocument: ${chunk.content}\nRelevance score (0-1):`,
              stream: false,
            }),
          });
          if (!res.ok) return { chunk, score: chunk.score };
          const data = (await res.json()) as { response: string };
          const score = parseFloat(data.response.trim());
          return { chunk, score: isNaN(score) ? chunk.score : score };
        } catch {
          return { chunk, score: chunk.score };
        }
      })
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ chunk, score }) => ({ ...chunk, score }));
  }
}

// ─── Contextual compressor ────────────────────────────────────────────────────

export interface CompressionResult {
  content: string;
  kept: boolean;
}

/**
 * Contextual compressor: filters out chunks that don't contain
 * any of the query terms (simple lexical relevance check).
 * A more sophisticated version would use an LLM to extract relevant sentences.
 */
export function compressChunk(query: string, content: string): CompressionResult {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);

  if (queryTerms.length === 0) return { content, kept: true };

  const contentLower = content.toLowerCase();
  const matchCount = queryTerms.filter((term) => contentLower.includes(term)).length;
  const matchRatio = matchCount / queryTerms.length;

  if (matchRatio < 0.2) {
    return { content: '', kept: false };
  }

  // Extract the most relevant sentences
  const sentences = content.split(/(?<=[.!?])\s+/);
  const scoredSentences = sentences.map((sentence) => {
    const sentLower = sentence.toLowerCase();
    const score = queryTerms.filter((term) => sentLower.includes(term)).length;
    return { sentence, score };
  });

  const relevant = scoredSentences
    .filter((s) => s.score > 0)
    .map((s) => s.sentence)
    .join(' ');

  return { content: relevant || content, kept: true };
}

export function compressResults(
  query: string,
  results: RetrievalResult[]
): Array<RetrievalResult & { compressionKept: boolean }> {
  return results
    .map((r) => {
      const { content, kept } = compressChunk(query, r.content);
      return { ...r, content, compressionKept: kept };
    })
    .filter((r) => r.compressionKept);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type RerankProviderName = 'COHERE' | 'CROSS_ENCODER' | 'NONE';

export function getReranker(provider: RerankProviderName): Reranker | null {
  switch (provider) {
    case 'COHERE':
      return new CohereReranker();
    case 'CROSS_ENCODER':
      return new CrossEncoderReranker();
    case 'NONE':
      return null;
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown rerank provider: ${_exhaustive}`);
    }
  }
}
