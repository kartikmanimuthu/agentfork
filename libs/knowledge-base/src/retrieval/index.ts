import { getPrismaClient } from '@chatbot/shared/workers';
import { LlmProviderService } from '@chatbot/shared/workers';
import {
  createDocumentChunkRepository,
  createKnowledgeBaseRepository,
} from '../repositories/index';
import { search } from '../search/index';
import { getEmbeddingProvider } from '../embeddings/index';
import { getReranker, compressResults } from '../reranking/index';
import type { RetrievalOptions, DetailedRetrievalResult } from '../types';

export class RetrievalService {
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;
  private readonly chunkRepo: ReturnType<typeof createDocumentChunkRepository>;

  constructor(private readonly tenantId: string) {
    const db = getPrismaClient();
    this.kbRepo = createKnowledgeBaseRepository(db);
    this.chunkRepo = createDocumentChunkRepository(db);
  }

  async retrieve(options: RetrievalOptions): Promise<DetailedRetrievalResult[]> {
    const kb = await this.kbRepo.findById(options.knowledgeBaseId);
    if (!kb || kb.tenantId !== this.tenantId) {
      throw new Error(`KnowledgeBase ${options.knowledgeBaseId} not found`);
    }

    // Merge options with KB defaults
    const topK = options.topK ?? (kb.retrievalConfig as any).topK ?? 10;
    const threshold = options.similarityThreshold ?? (kb.retrievalConfig as any).similarityThreshold ?? 0.7;
    const searchMode = options.searchMode ?? (kb.retrievalConfig as any).searchMode ?? 'HYBRID';
    const hybridAlpha = options.hybridAlpha ?? (kb.retrievalConfig as any).hybridAlpha ?? 0.7;
    const rerankProvider = options.rerankProvider ?? (kb.retrievalConfig as any).rerankProvider ?? 'NONE';
    const rerankTopK = options.rerankTopK ?? (kb.retrievalConfig as any).rerankTopK ?? topK;
    const useCompression = options.useCompression ?? (kb.retrievalConfig as any).useCompression ?? false;

    // Generate query embedding
    const embeddingProvider = await this.resolveEmbeddingProvider(
      kb.embeddingProvider,
      kb.embeddingModel,
      kb.embeddingDimensions
    );

    // For sparse-only search we don't need an embedding
    let queryEmbedding: number[] = [];
    if (searchMode !== 'SPARSE') {
      queryEmbedding = await embeddingProvider.embed(options.knowledgeBaseId);
    }

    // Run search
    let results = await search(
      this.chunkRepo,
      options.knowledgeBaseId,
      options.knowledgeBaseId, // query text placeholder — caller should pass query separately
      queryEmbedding,
      searchMode as any,
      topK,
      threshold,
      hybridAlpha
    );

    // Apply metadata filters
    if (options.metadataFilters && options.metadataFilters.length > 0) {
      results = results.filter((r) => matchesFilters(r.metadata, options.metadataFilters!));
    }

    // Rerank
    const reranker = getReranker(rerankProvider as any);
    if (reranker) {
      const reranked = await reranker.rerank(options.knowledgeBaseId, results, rerankTopK);
      results = reranked as DetailedRetrievalResult[];
    }

    // Compress
    if (useCompression) {
      const compressed = compressResults(options.knowledgeBaseId, results);
      results = compressed as DetailedRetrievalResult[];
    }

    return results;
  }

  /**
   * Retrieve with an explicit query string (preferred API).
   */
  async query(
    query: string,
    options: RetrievalOptions
  ): Promise<DetailedRetrievalResult[]> {
    const kb = await this.kbRepo.findById(options.knowledgeBaseId);
    if (!kb || kb.tenantId !== this.tenantId) {
      throw new Error(`KnowledgeBase ${options.knowledgeBaseId} not found`);
    }

    const topK = options.topK ?? (kb.retrievalConfig as any).topK ?? 10;
    const threshold = options.similarityThreshold ?? (kb.retrievalConfig as any).similarityThreshold ?? 0.7;
    const searchMode = options.searchMode ?? (kb.retrievalConfig as any).searchMode ?? 'HYBRID';
    const hybridAlpha = options.hybridAlpha ?? (kb.retrievalConfig as any).hybridAlpha ?? 0.7;
    const rerankProvider = options.rerankProvider ?? (kb.retrievalConfig as any).rerankProvider ?? 'NONE';
    const rerankTopK = options.rerankTopK ?? (kb.retrievalConfig as any).rerankTopK ?? topK;
    const useCompression = options.useCompression ?? (kb.retrievalConfig as any).useCompression ?? false;

    const embeddingProvider = await this.resolveEmbeddingProvider(
      kb.embeddingProvider,
      kb.embeddingModel,
      kb.embeddingDimensions
    );

    let queryEmbedding: number[] = [];
    if (searchMode !== 'SPARSE') {
      queryEmbedding = await embeddingProvider.embed(query);
    }

    let results = await search(
      this.chunkRepo,
      options.knowledgeBaseId,
      query,
      queryEmbedding,
      searchMode as any,
      topK,
      threshold,
      hybridAlpha
    );

    if (options.metadataFilters && options.metadataFilters.length > 0) {
      results = results.filter((r) => matchesFilters(r.metadata, options.metadataFilters!));
    }

    const reranker = getReranker(rerankProvider as any);
    if (reranker) {
      const reranked = await reranker.rerank(query, results, rerankTopK);
      results = reranked as DetailedRetrievalResult[];
    }

    if (useCompression) {
      const compressed = compressResults(query, results);
      results = compressed as DetailedRetrievalResult[];
    }

    return results;
  }

  private async resolveEmbeddingProvider(
    embeddingProvider: string,
    embeddingModel: string,
    embeddingDimensions: number
  ): Promise<ReturnType<typeof getEmbeddingProvider>> {
    const legacyProviders = ['BEDROCK_TITAN', 'OPENAI', 'COHERE', 'LOCAL'];

    if (legacyProviders.includes(embeddingProvider)) {
      return getEmbeddingProvider(embeddingProvider as any, {
        model: embeddingModel,
        dimensions: embeddingDimensions,
      });
    }

    const llmProviderService = new LlmProviderService(this.tenantId);
    const config = await llmProviderService.getConfigById(embeddingProvider);
    if (!config) {
      throw new Error(`LLM provider ${embeddingProvider} not found for tenant ${this.tenantId}`);
    }
    return getEmbeddingProvider(config, {
      model: embeddingModel,
      dimensions: embeddingDimensions,
    });
  }
}

// ─── Metadata filter matching ─────────────────────────────────────────────────

function matchesFilters(
  metadata: Record<string, unknown>,
  filters: RetrievalOptions['metadataFilters']
): boolean {
  if (!filters) return true;
  return filters.every((f) => {
    const val = metadata[f.field];
    switch (f.operator) {
      case 'eq': return val === f.value;
      case 'neq': return val !== f.value;
      case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(val);
      case 'contains':
        return typeof val === 'string' && typeof f.value === 'string' && val.includes(f.value);
      case 'gt': return typeof val === 'number' && typeof f.value === 'number' && val > f.value;
      case 'lt': return typeof val === 'number' && typeof f.value === 'number' && val < f.value;
      case 'between': {
        if (!Array.isArray(f.value) || f.value.length !== 2) return false;
        const [lo, hi] = f.value as [number, number];
        return typeof val === 'number' && val >= lo && val <= hi;
      }
      default: return true;
    }
  });
}
