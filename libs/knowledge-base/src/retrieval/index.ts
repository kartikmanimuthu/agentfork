import { getPrismaClient } from '@chatbot/shared/workers';
import { LlmProviderService } from '@chatbot/shared/workers';
import { createLogger } from '@chatbot/shared/workers';
import {
  createDocumentChunkRepository,
  createKnowledgeBaseRepository,
} from '../repositories/index';
import { search } from '../search/index';
import { getEmbeddingProvider } from '../embeddings/index';
import { getReranker, compressResults } from '../reranking/index';
import type { RetrievalOptions, DetailedRetrievalResult } from '../types';

const retrievalLogger = createLogger('kb:retrieval-service');

export class RetrievalService {
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;
  private readonly chunkRepo: ReturnType<typeof createDocumentChunkRepository>;

  constructor(private readonly tenantId: string) {
    const db = getPrismaClient();
    this.kbRepo = createKnowledgeBaseRepository(db);
    this.chunkRepo = createDocumentChunkRepository(db);
  }

  async retrieve(options: RetrievalOptions): Promise<DetailedRetrievalResult[]> {
    retrievalLogger.info(
      { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, searchMode: options.searchMode },
      'Starting retrieval'
    );
    try {
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

      retrievalLogger.debug(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, searchMode, topK },
        'Resolved retrieval options'
      );

      const embeddingProvider = await this.resolveEmbeddingProvider(
        kb.embeddingProvider,
        kb.embeddingModel,
        kb.embeddingDimensions
      );

      let queryEmbedding: number[] = [];
      if (searchMode !== 'SPARSE') {
        retrievalLogger.debug(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId },
          'Generating query embedding'
        );
        queryEmbedding = await embeddingProvider.embed(options.knowledgeBaseId);
      }

      let results = await search(
        this.chunkRepo,
        options.knowledgeBaseId,
        options.knowledgeBaseId,
        queryEmbedding,
        searchMode as any,
        topK,
        threshold,
        hybridAlpha
      );
      retrievalLogger.info(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, resultCount: results.length },
        'Search completed'
      );

      if (options.metadataFilters && options.metadataFilters.length > 0) {
        results = results.filter((r) => matchesFilters(r.metadata, options.metadataFilters!));
        retrievalLogger.info(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, filteredCount: results.length },
          'Applied metadata filters'
        );
      }

      const reranker = getReranker(rerankProvider as any);
      if (reranker) {
        retrievalLogger.debug(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, rerankProvider },
          'Applying reranker'
        );
        const reranked = await reranker.rerank(options.knowledgeBaseId, results, rerankTopK);
        results = reranked as DetailedRetrievalResult[];
      }

      if (useCompression) {
        retrievalLogger.debug(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId },
          'Applying compression'
        );
        const compressed = compressResults(options.knowledgeBaseId, results);
        results = compressed as DetailedRetrievalResult[];
      }

      retrievalLogger.info(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, finalCount: results.length },
        'Retrieval completed'
      );
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      retrievalLogger.error(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, errorMessage: error.message, errorStack: error.stack },
        'Retrieval failed'
      );
      throw error;
    }
  }

  async query(
    query: string,
    options: RetrievalOptions
  ): Promise<DetailedRetrievalResult[]> {
    retrievalLogger.info(
      { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, query, searchMode: options.searchMode },
      'Starting query retrieval'
    );
    try {
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

      retrievalLogger.debug(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, searchMode, topK },
        'Resolved retrieval options'
      );

      const embeddingProvider = await this.resolveEmbeddingProvider(
        kb.embeddingProvider,
        kb.embeddingModel,
        kb.embeddingDimensions
      );

      let queryEmbedding: number[] = [];
      if (searchMode !== 'SPARSE') {
        retrievalLogger.debug(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId },
          'Generating query embedding'
        );
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
      retrievalLogger.info(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, resultCount: results.length },
        'Search completed'
      );

      if (options.metadataFilters && options.metadataFilters.length > 0) {
        results = results.filter((r) => matchesFilters(r.metadata, options.metadataFilters!));
        retrievalLogger.info(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, filteredCount: results.length },
          'Applied metadata filters'
        );
      }

      const reranker = getReranker(rerankProvider as any);
      if (reranker) {
        retrievalLogger.debug(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, rerankProvider },
          'Applying reranker'
        );
        const reranked = await reranker.rerank(query, results, rerankTopK);
        results = reranked as DetailedRetrievalResult[];
      }

      if (useCompression) {
        retrievalLogger.debug(
          { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId },
          'Applying compression'
        );
        const compressed = compressResults(query, results);
        results = compressed as DetailedRetrievalResult[];
      }

      retrievalLogger.info(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, finalCount: results.length },
        'Query retrieval completed'
      );
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      retrievalLogger.error(
        { tenantId: this.tenantId, knowledgeBaseId: options.knowledgeBaseId, query, errorMessage: error.message, errorStack: error.stack },
        'Query retrieval failed'
      );
      throw error;
    }
  }

  private async resolveEmbeddingProvider(
    embeddingProvider: string,
    embeddingModel: string,
    embeddingDimensions: number
  ): Promise<ReturnType<typeof getEmbeddingProvider>> {
    retrievalLogger.debug(
      { tenantId: this.tenantId, embeddingProvider, embeddingModel, embeddingDimensions },
      'Resolving embedding provider'
    );
    try {
      const legacyProviders = ['BEDROCK_TITAN', 'OPENAI', 'COHERE', 'LOCAL'];

      if (legacyProviders.includes(embeddingProvider)) {
        const provider = getEmbeddingProvider(embeddingProvider as any, {
          model: embeddingModel,
          dimensions: embeddingDimensions,
        });
        retrievalLogger.debug(
          { tenantId: this.tenantId, embeddingProvider },
          'Resolved legacy embedding provider'
        );
        return provider;
      }

      const llmProviderService = new LlmProviderService(this.tenantId);
      const config = await llmProviderService.getConfigById(embeddingProvider);
      if (!config) {
        throw new Error(`LLM provider ${embeddingProvider} not found for tenant ${this.tenantId}`);
      }
      const provider = getEmbeddingProvider(config, {
        model: embeddingModel,
        dimensions: embeddingDimensions,
      });
      retrievalLogger.debug(
        { tenantId: this.tenantId, embeddingProvider: config.provider },
        'Resolved config-based embedding provider'
      );
      return provider;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      retrievalLogger.error(
        { tenantId: this.tenantId, embeddingProvider, embeddingModel, errorMessage: error.message, errorStack: error.stack },
        'Failed to resolve embedding provider'
      );
      throw error;
    }
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
