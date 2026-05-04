import { getPrismaClient } from '@chatbot/shared/workers';
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

  log.info('Starting document ingestion', { documentId, knowledgeBaseId });

  const db = getPrismaClient();
  const docRepo = createDocumentRepository(db);
  const chunkRepo = createDocumentChunkRepository(db);
  const kbRepo = createKnowledgeBaseRepository(db);

  // Mark as processing
  await docRepo.update(documentId, { status: 'PROCESSING' });

  try {
    // 1. Fetch KB config
    const kb = await kbRepo.findById(knowledgeBaseId);
    if (!kb) throw new Error(`KnowledgeBase ${knowledgeBaseId} not found`);

    // 2. Download from S3
    log.info('Downloading from S3', { s3Key });
    const buffer = await downloadFromS3(s3Key);

    // 3. Parse document
    log.info('Parsing document', { mimeType });
    await docRepo.update(documentId, { status: 'PROCESSING' });
    const parser = getDocumentParser(mimeType);
    const rawText = await parser.parse(buffer, mimeType);

    // 4. Pre-process
    const preProcessingConfig = kb.preProcessing as {
      htmlStripping: boolean;
      piiRedaction: boolean;
      piiPatterns?: string[];
      ocrEnabled: boolean;
      tableExtraction: boolean;
    };
    const { text: processedText } = runPreProcessingPipeline(rawText, preProcessingConfig);
    await docRepo.update(documentId, { processedText, status: 'CHUNKING' });

    // 5. Chunk
    log.info('Chunking document', { strategy: kb.chunkStrategy });
    const chunker = getChunker(kb.chunkStrategy as any);
    const chunks = chunker.chunk(processedText, kb.chunkSize, kb.chunkOverlap);

    // 6. Store chunks (without embeddings first)
    const chunkRecords = await chunkRepo.createMany(
      chunks.map((c, i) => ({
        documentId,
        chunkIndex: i,
        content: c.content,
        tokenCount: c.tokenCount,
        metadata: c.metadata as Record<string, unknown>,
      }))
    );
    log.info('Chunks stored', { count: chunkRecords });

    // 7. Embed chunks
    log.info('Embedding chunks', { provider: kb.embeddingProvider });
    await docRepo.update(documentId, { status: 'EMBEDDING' });

    const embeddingProvider = getEmbeddingProvider(kb.embeddingProvider as any, {
      model: kb.embeddingModel,
      dimensions: kb.embeddingDimensions,
    });

    // Fetch the stored chunk IDs
    const storedChunks = await chunkRepo.findByDocumentId(documentId, { limit: chunks.length + 10 });
    const batchSize = embeddingProvider.maxBatchSize;

    for (let i = 0; i < storedChunks.items.length; i += batchSize) {
      const batch = storedChunks.items.slice(i, i + batchSize);
      const embeddings = await embeddingProvider.embedBatch(batch.map((c) => c.content));
      await chunkRepo.updateEmbeddingBatch(
        batch.map((c, j) => ({ id: c.id, embedding: embeddings[j] }))
      );
    }

    // 8. Update tsvector for sparse search
    await db.$executeRaw`
      UPDATE document_chunks
      SET search_text = to_tsvector('english', content)
      WHERE "documentId" = ${documentId}
    `;

    // 9. Mark document as ready
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    await docRepo.update(documentId, {
      status: 'READY',
      tokenCount: totalTokens,
    });

    // 10. Increment KB counters
    await kbRepo.incrementCounts(knowledgeBaseId, 1, chunks.length);

    log.info('Document ingestion complete', { documentId, chunks: chunks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Document ingestion failed', { error: message });
    await docRepo.update(documentId, { status: 'FAILED', errorMessage: message });
    throw err;
  }
}

async function downloadFromS3(s3Key: string): Promise<Buffer> {
  // @ts-ignore — @aws-sdk/client-s3 is an optional peer dependency
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3').catch(() => {
    throw new Error('S3 download requires "@aws-sdk/client-s3".');
  });

  const bucket = process.env['KB_S3_BUCKET'] ?? 'chatbot-knowledge-base-dev';
  const region = process.env['AWS_REGION'] ?? 'ap-south-1';
  const client = new S3Client({ region });

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
  if (!response.Body) throw new Error(`S3 object not found: ${s3Key}`);

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
