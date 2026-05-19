import { getPrismaClient } from '@chatbot/shared/workers';
import { S3Service, LlmProviderService } from '@chatbot/shared';
import {
  createDocumentRepository,
  createDocumentChunkRepository,
  createKnowledgeBaseRepository,
  getDocumentParser,
  getChunker,
  getEmbeddingProvider,
  runPreProcessingPipeline,
} from '@chatbot/knowledge-base';
import { createLogger } from '../../lib/logger.js';
import { documentIngestionJobSchema } from './schema.js';

const log = createLogger('document-ingestion');

export async function handleDocumentIngestion(data: unknown): Promise<void> {
  const { documentId, tenantId, s3Key, mimeType, knowledgeBaseId } =
    documentIngestionJobSchema.parse(data);

  log.info({ documentId, tenantId, knowledgeBaseId, s3Key, mimeType }, 'Starting document ingestion');

  const db = getPrismaClient();
  const docRepo = createDocumentRepository(db);
  const chunkRepo = createDocumentChunkRepository(db);
  const kbRepo = createKnowledgeBaseRepository(db);

  // Check document exists before doing any work — job may reference a deleted document
  const existingDoc = await docRepo.findById(documentId);
  if (!existingDoc) {
    log.warn({ documentId }, 'Document not found, skipping job');
    return;
  }

  // Mark as processing
  await docRepo.update(documentId, { status: 'PROCESSING' });
  log.info({ documentId }, 'Document status set to PROCESSING');

  try {
    // 1. Fetch KB config
    const kb = await kbRepo.findById(knowledgeBaseId);
    if (!kb) throw new Error(`KnowledgeBase ${knowledgeBaseId} not found`);
    log.info({ documentId, knowledgeBaseId, embeddingProvider: kb.embeddingProvider, embeddingModel: kb.embeddingModel, embeddingDimensions: kb.embeddingDimensions, chunkStrategy: kb.chunkStrategy, chunkSize: kb.chunkSize, chunkOverlap: kb.chunkOverlap }, 'KB config loaded');

    // 2. Download from S3
    log.info({ documentId, s3Key }, 'Downloading document from S3');
    const s3 = new S3Service();
    const buffer = await s3.downloadAsBuffer(s3Key);
    log.info({ documentId, s3Key, bufferSizeBytes: buffer.length }, 'S3 download complete');

    // 3. Parse document
    log.info({ documentId, mimeType }, 'Parsing document');
    await docRepo.update(documentId, { status: 'PROCESSING' });
    const parser = getDocumentParser(mimeType);
    const rawText = await parser.parse(buffer, mimeType);
    log.info({ documentId, mimeType, rawTextLength: rawText.length }, 'Document parsed successfully');

    // 4. Pre-process
    const preProcessingConfig = kb.preProcessing as {
      htmlStripping: boolean;
      piiRedaction: boolean;
      piiPatterns?: string[];
      ocrEnabled: boolean;
      tableExtraction: boolean;
    };
    log.info({ documentId, preProcessingConfig }, 'Running pre-processing pipeline');
    const { text: processedText, appliedSteps } = runPreProcessingPipeline(rawText, preProcessingConfig);
    log.info({ documentId, processedTextLength: processedText.length, appliedSteps }, 'Pre-processing complete');
    await docRepo.update(documentId, { processedText, status: 'CHUNKING' });

    // 5. Chunk
    log.info({ documentId, strategy: kb.chunkStrategy, chunkSize: kb.chunkSize, chunkOverlap: kb.chunkOverlap }, 'Chunking document');
    const chunker = getChunker(kb.chunkStrategy as any);
    const chunks = chunker.chunk(processedText, kb.chunkSize, kb.chunkOverlap);
    log.info({ documentId, chunkCount: chunks.length, totalTokens: chunks.reduce((s, c) => s + c.tokenCount, 0) }, 'Chunking complete');

    // 6. Store chunks (without embeddings first)
    log.info({ documentId, chunkCount: chunks.length }, 'Storing chunks in database');
    const chunkRecords = await chunkRepo.createMany(
      chunks.map((c, i) => ({
        documentId,
        chunkIndex: i,
        content: c.content,
        tokenCount: c.tokenCount,
        metadata: c.metadata as Record<string, unknown>,
      }))
    );
    log.info({ documentId, storedCount: chunkRecords }, 'Chunks stored successfully');

    // 7. Embed chunks
    await docRepo.update(documentId, { status: 'EMBEDDING' });

    const legacyProviders = ['BEDROCK_TITAN', 'OPENAI', 'COHERE', 'LOCAL'];
    let embeddingProvider: ReturnType<typeof getEmbeddingProvider>;

    if (legacyProviders.includes(kb.embeddingProvider)) {
      log.info({ documentId, provider: kb.embeddingProvider, model: kb.embeddingModel, dimensions: kb.embeddingDimensions }, 'Using legacy embedding provider');
      embeddingProvider = getEmbeddingProvider(kb.embeddingProvider as any, {
        model: kb.embeddingModel,
        dimensions: kb.embeddingDimensions,
      });
    } else {
      log.info({ documentId, providerId: kb.embeddingProvider, tenantId }, 'Resolving tenant-specific LLM provider');
      const llmProviderService = new LlmProviderService(tenantId);
      const providerConfig = await llmProviderService.getConfigById(kb.embeddingProvider);
      if (!providerConfig) {
        throw new Error(`LLM provider ${kb.embeddingProvider} not found for tenant ${tenantId}`);
      }
      log.info({ documentId, resolvedProvider: providerConfig.provider, model: kb.embeddingModel }, 'Tenant LLM provider resolved');
      embeddingProvider = getEmbeddingProvider(providerConfig, {
        model: kb.embeddingModel,
        dimensions: kb.embeddingDimensions,
      });
    }

    // Fetch the stored chunk IDs
    const storedChunks = await chunkRepo.findByDocumentId(documentId, { limit: chunks.length + 10 });
    const batchSize = embeddingProvider.maxBatchSize;
    const totalBatches = Math.ceil(storedChunks.items.length / batchSize);
    log.info({ documentId, totalChunks: storedChunks.items.length, batchSize, totalBatches }, 'Starting embedding batches');

    for (let i = 0; i < storedChunks.items.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize) + 1;
      const batch = storedChunks.items.slice(i, i + batchSize);
      log.info({ documentId, batchIndex, totalBatches, batchChunkCount: batch.length }, 'Embedding batch');

      const embeddings = await embeddingProvider.embedBatch(batch.map((c) => c.content));
      log.debug({ documentId, batchIndex, embeddingsDimensions: embeddings[0]?.length }, 'Embeddings generated');

      await chunkRepo.updateEmbeddingBatch(
        batch.map((c, j) => ({ id: c.id, embedding: embeddings[j] }))
      );
      log.info({ documentId, batchIndex, totalBatches }, 'Embedding batch stored');
    }

    // 8. Update tsvector for sparse search
    log.info({ documentId }, 'Updating tsvector for full-text search');
    await db.$executeRaw`
      UPDATE document_chunks
      SET "searchText" = to_tsvector('english', content)
      WHERE "documentId" = ${documentId}
    `;
    log.info({ documentId }, 'tsvector update complete');

    // 9. Mark document as ready
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    await docRepo.update(documentId, {
      status: 'READY',
      tokenCount: totalTokens,
    });

    // 10. Increment KB counters
    await kbRepo.incrementCounts(knowledgeBaseId, 1, chunks.length);

    log.info({ documentId, knowledgeBaseId, chunkCount: chunks.length, totalTokens }, 'Document ingestion complete — status READY');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error({ documentId, knowledgeBaseId, errorMessage: message, errorStack: stack }, 'Document ingestion failed');

    // Permanent failures — mark FAILED but do NOT re-throw so pg-boss won't retry
    const isPermanent =
      message.includes('The specified key does not exist') ||
      message.includes('NoSuchKey') ||
      (message.includes('KnowledgeBase') && message.includes('not found'));

    if (isPermanent) {
      await docRepo.update(documentId, { status: 'FAILED', errorMessage: message });
      log.warn({ documentId, errorMessage: message }, 'Permanent failure — not retrying');
      return;
    }

    await docRepo.update(documentId, { status: 'FAILED', errorMessage: message });
    throw err;
  }
}
