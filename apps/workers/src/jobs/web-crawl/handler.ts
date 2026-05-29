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

  log.info({ dataSourceId, tenantId, knowledgeBaseId }, 'Starting web crawl job');

  const db = getPrismaClient();
  const dsRepo = createDataSourceRepository(db);
  const docRepo = createDocumentRepository(db);
  const kbRepo = createKnowledgeBaseRepository(db);

  // Update data source status to syncing
  await dsRepo.update(dataSourceId, { status: 'syncing', errorMessage: null });
  log.info({ dataSourceId }, 'Data source status set to syncing');

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
      useHeadless?: boolean;
      restrictToSameSubdomain?: boolean;
    };

    log.info({ dataSourceId, urls: config.urls, crawlDepth: config.crawlDepth, includePatterns: config.includePatterns, excludePatterns: config.excludePatterns, useHeadless: config.useHeadless, restrictToSameSubdomain: config.restrictToSameSubdomain }, 'Data source config loaded');

    // Run crawler
    const crawler = createWebCrawler({ useHeadless: config.useHeadless });
    const pages = await crawler.crawl({
      seedUrls: config.urls,
      crawlDepth: config.crawlDepth ?? 0,
      includePatterns: config.includePatterns,
      excludePatterns: config.excludePatterns,
      maxPages: 50,
      useHeadless: config.useHeadless,
      restrictToSameSubdomain: config.restrictToSameSubdomain,
    });

    log.info({ dataSourceId, pagesFound: pages.length }, 'Crawl complete, processing pages');

    // Create document records and enqueue ingestion for each page
    const docService = new DocumentService(tenantId);
    const ingestionService = new IngestionService(tenantId);
    const s3 = new S3Service();

    let successCount = 0;
    let failCount = 0;

    for (let idx = 0; idx < pages.length; idx++) {
      const page = pages[idx];
      const fileName = `${page.url.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
      const mimeType = 'text/markdown';
      const mdBuffer = Buffer.from(page.markdown, 'utf-8');

      log.info({ dataSourceId, pageIndex: idx, url: page.url, markdownLength: mdBuffer.length }, 'Processing crawled page');

      try {
        // Generate S3 key and upload text directly via SDK
        const { s3Key } = await docService.getUploadUrl(dataSourceId, fileName, mimeType);
        log.debug({ dataSourceId, url: page.url, s3Key }, 'S3 key generated for page');

        await s3.uploadBuffer(s3Key, mdBuffer, mimeType);
        log.debug({ dataSourceId, url: page.url, s3Key, sizeBytes: mdBuffer.length }, 'Page markdown uploaded to S3');

        // Create document record
        const document = await docRepo.create({
          dataSourceId,
          sourceKey: s3Key,
          fileName,
          mimeType,
          sizeBytes: mdBuffer.length,
          metadata: { url: page.url, title: page.title, textLength: page.textLength, fetchedAt: page.fetchedAt.toISOString() },
        });
        log.info({ dataSourceId, url: page.url, documentId: document.id, s3Key }, 'Document record created');

        // Enqueue document ingestion
        if (boss) {
          const jobId = await ingestionService.enqueueIngestion(boss, {
            documentId: document.id,
            tenantId,
            s3Key,
            mimeType,
            knowledgeBaseId,
          });
          log.info({ dataSourceId, documentId: document.id, jobId }, 'Ingestion job enqueued');
        }

        successCount++;
      } catch (pageErr) {
        failCount++;
        const pageError = pageErr instanceof Error ? pageErr : new Error(String(pageErr));
        log.error({ dataSourceId, url: page.url, pageIndex: idx, errorMessage: pageError.message, errorStack: pageError.stack }, 'Failed to process crawled page — continuing to next page');
        // Continue to next page instead of aborting the entire crawl job
      }
    }

    // Update data source status
    await dsRepo.update(dataSourceId, { status: 'active', lastSyncAt: new Date() });

    log.info({ dataSourceId, knowledgeBaseId, totalPages: pages.length, successCount, failCount }, 'Web crawl job complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error({ dataSourceId, knowledgeBaseId, errorMessage: message, errorStack: stack }, 'Web crawl job failed');
    await dsRepo.update(dataSourceId, { status: 'error', errorMessage: message });
    throw err;
  }
}
