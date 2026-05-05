import type { DocumentChunkRepository, DocumentChunkWithScore } from '../repositories/index';
import type { RetrievalResult, DetailedRetrievalResult, SearchMode } from '../types';

// ─── Dense search ─────────────────────────────────────────────────────────────

export async function denseSearch(
  chunkRepo: DocumentChunkRepository,
  knowledgeBaseId: string,
  queryEmbedding: number[],
  topK: number,
  threshold: number
): Promise<DetailedRetrievalResult[]> {
  const results = await chunkRepo.searchByVector(knowledgeBaseId, queryEmbedding, topK, threshold);
  return results.map((r) => toDetailedResult(r, { denseScore: r.score }));
}

// ─── Sparse search ────────────────────────────────────────────────────────────

export async function sparseSearch(
  chunkRepo: DocumentChunkRepository,
  knowledgeBaseId: string,
  query: string,
  topK: number
): Promise<DetailedRetrievalResult[]> {
  const results = await chunkRepo.searchByText(knowledgeBaseId, query, topK);
  return results.map((r) => toDetailedResult(r, { sparseScore: r.score }));
}

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

const RRF_K = 60;

export function reciprocalRankFusion(
  denseResults: DetailedRetrievalResult[],
  sparseResults: DetailedRetrievalResult[],
  topK: number,
  alpha: number // weight for dense (1-alpha for sparse)
): DetailedRetrievalResult[] {
  const scores = new Map<string, { result: DetailedRetrievalResult; rrfScore: number }>();

  const addRank = (results: DetailedRetrievalResult[], weight: number) => {
    results.forEach((r, rank) => {
      const rrfContrib = weight / (RRF_K + rank + 1);
      const existing = scores.get(r.chunkId);
      if (existing) {
        existing.rrfScore += rrfContrib;
        // Merge scores
        if (r.denseScore !== undefined) existing.result.denseScore = r.denseScore;
        if (r.sparseScore !== undefined) existing.result.sparseScore = r.sparseScore;
      } else {
        scores.set(r.chunkId, { result: { ...r }, rrfScore: rrfContrib });
      }
    });
  };

  addRank(denseResults, alpha);
  addRank(sparseResults, 1 - alpha);

  return Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK)
    .map(({ result, rrfScore }) => ({ ...result, rrfScore, score: rrfScore }));
}

// ─── Hybrid search ────────────────────────────────────────────────────────────

export async function hybridSearch(
  chunkRepo: DocumentChunkRepository,
  knowledgeBaseId: string,
  query: string,
  queryEmbedding: number[],
  topK: number,
  threshold: number,
  alpha: number
): Promise<DetailedRetrievalResult[]> {
  const [dense, sparse] = await Promise.all([
    denseSearch(chunkRepo, knowledgeBaseId, queryEmbedding, topK * 2, threshold),
    sparseSearch(chunkRepo, knowledgeBaseId, query, topK * 2),
  ]);
  return reciprocalRankFusion(dense, sparse, topK, alpha);
}

// ─── Unified search dispatcher ────────────────────────────────────────────────

export async function search(
  chunkRepo: DocumentChunkRepository,
  knowledgeBaseId: string,
  query: string,
  queryEmbedding: number[],
  mode: SearchMode,
  topK: number,
  threshold: number,
  hybridAlpha: number
): Promise<DetailedRetrievalResult[]> {
  switch (mode) {
    case 'DENSE':
      return denseSearch(chunkRepo, knowledgeBaseId, queryEmbedding, topK, threshold);
    case 'SPARSE':
      return sparseSearch(chunkRepo, knowledgeBaseId, query, topK);
    case 'HYBRID':
      return hybridSearch(chunkRepo, knowledgeBaseId, query, queryEmbedding, topK, threshold, hybridAlpha);
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown search mode: ${_exhaustive}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDetailedResult(
  r: DocumentChunkWithScore,
  scores: Partial<Pick<DetailedRetrievalResult, 'denseScore' | 'sparseScore'>>
): DetailedRetrievalResult {
  return {
    chunkId: r.id,
    content: r.content,
    score: r.score,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    documentId: r.documentId,
    documentName: r.documentName ?? '',
    compressionKept: true,
    ...scores,
  };
}

export type { DetailedRetrievalResult, RetrievalResult };
