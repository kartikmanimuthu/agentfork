import type PgBoss from 'pg-boss';
import { getPrismaClient } from '@chatbot/shared/workers';
import { S3Service } from '@chatbot/shared';
import {
  createDataSourceRepository,
  createDocumentRepository,
  createKnowledgeBaseRepository,
  createWebCrawler,
  DataSourceService,
  DocumentService,
  IngestionService,
} from '@chatbot/knowledge-base';
import { createLogger } from '../../lib/logger.js';
import { webCrawlJobSchema } from './schema.js';

const log = createLogger('web-crawl');

export async function handleWebCrawl(data: unknown, boss?: PgBoss): Promise<void> {
  const { dataSourceId, tenantId, knowledgeBaseId } = webCrawlJobSchema.parse(data);

  log.info('Starting web crawl', { dataSourceId, knowledgeBaseId });

  const db = getPrismaClient();
  const dsRepo = createDataSourceRepository(db);
  const docRepo = createDocumentRepository(db);
  const kbRepo = createKnowledgeBaseRepository(db);

  // Update data source status to syncing
  await dsRepo.update(dataSourceId, { status: 'syncing', errorMessage: null });

  try {
    // Fetch data source
    const ds = await dsRepo.findById(dataSourceId);
    if (!ds) throw new Error(`DataSource ${dataSourceId} not found`);
    if (ds.type !== 'URL') throw new Error(`DataSource ${dataSourceId} is not a URL source`);

    const config = ds.config as {
      urls: string[];
      crawlDepth: number;
      includePatterns?: string[];
      excludePatterns?: string[];
    };

    // Run crawler
    const crawler = createWebCrawler({ delayMs: 500 });
    const pages = await crawler.crawl({
      seedUrls: config.urls,
      crawlDepth: config.crawlDepth ?? 0,
      includePatterns: config.includePatterns,
      excludePatterns: config.excludePatterns,
      maxPages: 50,
    });

    log.info('Crawl complete', { pages: pages.length });

    // Create document records and enqueue ingestion for each page
    const docService = new DocumentService(tenantId);
    const ingestionService = new IngestionService(tenantId);

    for (const page of pages) {
      const fileName = `${page.url.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
      const mimeType = 'text/plain';
      const textBuffer = Buffer.from(page.text, 'utf-8');

      // Generate S3 key and upload text directly via SDK (pre-signed URLs break on region redirects)
      const { s3Key } = await docService.getUploadUrl(dataSourceId, fileName, mimeType);
      const s3 = new S3Service();
      await s3.uploadBuffer(s3Key, textBuffer, mimeType);

      // Create document record
      const document = await docRepo.create({
        dataSourceId,
        sourceKey: s3Key,
        fileName,
        mimeType,
        sizeBytes: textBuffer.length,
        metadata: { url: page.url, title: page.title, fetchedAt: page.fetchedAt.toISOString() },
      });

      // Enqueue document ingestion
      if (boss) {
        await ingestionService.enqueueIngestion(boss, {
          documentId: document.id,
          tenantId,
          s3Key,
          mimeType,
          knowledgeBaseId,
        });
      }
    }

    // Update data source status
    await dsRepo.update(dataSourceId, { status: 'active', lastSyncAt: new Date() });

    log.info('Web crawl job complete', { dataSourceId, pages: pages.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Web crawl failed', { error: message });
    await dsRepo.update(dataSourceId, { status: 'error', errorMessage: message });
    throw err;
  }
}
