#!/usr/bin/env node
/**
 * Local testing script for Knowledge Base sync and web crawler.
 *
 * Usage:
 *   npx tsx --env-file=../../.env src/scripts/test-kb-sync.ts [options]
 *
 * Options:
 *   --create              Auto-create a test KnowledgeBase + URL DataSource
 *   --kb-id <id>          Existing KnowledgeBase ID (required if not --create)
 *   --source-id <id>        Existing DataSource ID (required if not --create)
 *   --tenant-id <id>        Tenant ID (defaults to first active tenant when --create)
 *   --full-pipeline         Also run document ingestion after sync
 *   --cleanup               Delete created test records after run
 *   --crawl-only            Test web crawler in isolation (no DB writes)
 *   --url <url>             URL to crawl when using --crawl-only
 *   --crawl-depth <n>       Crawl depth (default: 0)
 *   --max-pages <n>         Max pages to crawl (default: 10)
 *   --help                  Show this help
 */

import { getPrismaClient } from '@chatbot/shared/workers';
import {
  createWebCrawler,
  createDataSourceRepository,
  createDocumentRepository,
  createKnowledgeBaseRepository,
  createDocumentChunkRepository,
} from '@chatbot/knowledge-base';
import { handleWebCrawl } from '../jobs/web-crawl/handler.js';
import { handleDocumentIngestion } from '../jobs/document-ingestion/handler.js';
import { createBoss } from '../boss.js';

const TEST_KB_NAME = '__test_kb_sync';

interface Args {
  create: boolean;
  kbId: string | null;
  sourceId: string | null;
  tenantId: string | null;
  fullPipeline: boolean;
  cleanup: boolean;
  crawlOnly: boolean;
  url: string | null;
  crawlDepth: number;
  maxPages: number;
  help: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    create: false,
    kbId: null,
    sourceId: null,
    tenantId: null,
    fullPipeline: false,
    cleanup: false,
    crawlOnly: false,
    url: null,
    crawlDepth: 0,
    maxPages: 10,
    help: false,
  };

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--create':
        args.create = true;
        break;
      case '--kb-id':
        args.kbId = argv[++i] ?? null;
        break;
      case '--source-id':
        args.sourceId = argv[++i] ?? null;
        break;
      case '--tenant-id':
        args.tenantId = argv[++i] ?? null;
        break;
      case '--full-pipeline':
        args.fullPipeline = true;
        break;
      case '--cleanup':
        args.cleanup = true;
        break;
      case '--crawl-only':
        args.crawlOnly = true;
        break;
      case '--url':
        args.url = argv[++i] ?? null;
        break;
      case '--crawl-depth':
        args.crawlDepth = parseInt(argv[++i] ?? '0', 10);
        break;
      case '--max-pages':
        args.maxPages = parseInt(argv[++i] ?? '10', 10);
        break;
      case '--help':
        args.help = true;
        break;
      default:
        console.warn(`Unknown arg: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Local testing script for Knowledge Base sync and web crawler.

Usage:
  npx tsx --env-file=../../.env src/scripts/test-kb-sync.ts [options]

Options:
  --create              Auto-create a test KnowledgeBase + URL DataSource
  --kb-id <id>          Existing KnowledgeBase ID
  --source-id <id>        Existing DataSource ID
  --tenant-id <id>        Tenant ID (defaults to first active tenant when --create)
  --full-pipeline         Also run document ingestion after sync
  --cleanup               Delete created test records after run
  --crawl-only            Test web crawler in isolation (no DB writes)
  --url <url>             URL to crawl when using --crawl-only
  --crawl-depth <n>       Crawl depth (default: 0)
  --max-pages <n>         Max pages to crawl (default: 10)
  --help                  Show this help

Examples:
  # Full pipeline with auto-created test records
  npx tsx --env-file=../../.env src/scripts/test-kb-sync.ts --create --full-pipeline --cleanup

  # Crawl-only test (no DB side effects)
  npx tsx --env-file=../../.env src/scripts/test-kb-sync.ts --crawl-only --url https://example.com

  # Sync an existing source
  npx tsx --env-file=../../.env src/scripts/test-kb-sync.ts --kb-id <kb-id> --source-id <source-id> --tenant-id <tenant-id>
`);
}

async function findOrCreateTenant(db: any, tenantId: string | null): Promise<string> {
  if (tenantId) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    return tenantId;
  }

  const tenant = await db.tenant.findFirst({ where: { status: 'active' } });
  if (!tenant) throw new Error('No active tenant found in database. Pass --tenant-id or create a tenant.');
  console.log(`Using tenant: ${tenant.id} (${tenant.name})`);
  return tenant.id;
}

async function createTestData(db: any, tenantId: string) {
  console.log('\n--- SETUP: Creating test data ---');

  const existingKb = await db.knowledgeBase.findFirst({
    where: { tenantId, name: TEST_KB_NAME },
  });

  if (existingKb) {
    console.log(`Found existing test KB: ${existingKb.id}`);
  }

  const kb = existingKb ?? (await db.knowledgeBase.create({
    data: {
      tenantId,
      name: TEST_KB_NAME,
      description: 'Auto-created for sync testing',
      status: 'active',
    },
  }));

  const existingSource = await db.dataSource.findFirst({
    where: { knowledgeBaseId: kb.id, type: 'URL' },
  });

  const source =
    existingSource ??
    (await db.dataSource.create({
      data: {
        knowledgeBaseId: kb.id,
        type: 'URL',
        config: {
          urls: ['https://example.com'],
          crawlDepth: 0,
          includePatterns: [],
          excludePatterns: [],
        },
        status: 'active',
      },
    }));

  console.log(`KnowledgeBase: ${kb.id}`);
  console.log(`DataSource:    ${source.id}`);

  return { kbId: kb.id, sourceId: source.id, tenantId };
}

async function cleanupTestData(db: any, kbId: string, sourceId: string) {
  console.log('\n--- CLEANUP: Removing test data ---');

  const documents = await db.document.findMany({ where: { dataSourceId: sourceId } });
  for (const doc of documents) {
    await db.documentChunk.deleteMany({ where: { documentId: doc.id } });
    await db.document.delete({ where: { id: doc.id } });
  }
  console.log(`Deleted ${documents.length} document(s)`);

  await db.dataSource.delete({ where: { id: sourceId } }).catch(() => {});
  await db.knowledgeBase.delete({ where: { id: kbId } }).catch(() => {});
  console.log('Deleted test KnowledgeBase and DataSource');
}

async function runCrawlOnly(args: Args) {
  const url = args.url ?? 'https://example.com';
  console.log(`\n--- CRAWL-ONLY TEST ---`);
  console.log(`Target URL: ${url}`);
  console.log(`Crawl depth: ${args.crawlDepth}, Max pages: ${args.maxPages}`);

  const crawler = createWebCrawler({ delayMs: 500 });
  const start = Date.now();
  const pages = await crawler.crawl({
    seedUrls: [url],
    crawlDepth: args.crawlDepth,
    maxPages: args.maxPages,
  });
  const elapsed = Date.now() - start;

  console.log(`\nCrawl complete in ${elapsed}ms`);
  console.log(`Pages found: ${pages.length}`);

  for (const page of pages) {
    console.log(`\n  URL:    ${page.url}`);
    console.log(`  Title:  ${page.title ?? '(none)'}`);
    console.log(`  Length: ${page.text.length} chars`);
    console.log(`  Links:  ${page.links.length}`);
    console.log(`  Fetched: ${page.fetchedAt.toISOString()}`);
  }

  if (pages.length === 0) {
    console.error('\nERROR: No pages were crawled.');
    process.exit(1);
  }

  console.log('\nCrawl-only test PASSED');
}

async function runSyncAndIngest(args: Args) {
  const db = getPrismaClient();

  let kbId = args.kbId;
  let sourceId = args.sourceId;
  let tenantId = args.tenantId;

  try {
    tenantId = await findOrCreateTenant(db, tenantId);

    if (args.create) {
      const created = await createTestData(db, tenantId);
      kbId = created.kbId;
      sourceId = created.sourceId;
      tenantId = created.tenantId;
    }

    if (!kbId || !sourceId) {
      console.error('Error: --kb-id and --source-id are required unless using --create');
      process.exit(1);
    }

    const source = await db.dataSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new Error(`DataSource ${sourceId} not found`);
    if (source.type !== 'URL') throw new Error(`DataSource ${sourceId} is not a URL source (type: ${source.type})`);

    const kb = await db.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) throw new Error(`KnowledgeBase ${kbId} not found`);

    console.log('\n--- SYNC TEST ---');
    console.log(`KnowledgeBase: ${kbId}`);
    console.log(`DataSource:    ${sourceId}`);
    console.log(`Tenant:        ${tenantId}`);
    console.log(`Type:          ${source.type}`);
    console.log(`URL config:    ${JSON.stringify(source.config)}`);

    const boss = createBoss();
    await boss.start();

    const syncStart = Date.now();
    await handleWebCrawl({ dataSourceId: sourceId, tenantId, knowledgeBaseId: kbId }, boss);
    const syncElapsed = Date.now() - syncStart;

    await boss.stop({ graceful: false });

    console.log(`\nSync handler completed in ${syncElapsed}ms`);

    const updatedSource = await db.dataSource.findUnique({ where: { id: sourceId } });
    const documents = await db.document.findMany({ where: { dataSourceId: sourceId } });

    console.log('\n--- SYNC VALIDATION ---');
    console.log(`DataSource status:     ${updatedSource?.status ?? 'N/A'}`);
    console.log(`DataSource lastSyncAt: ${updatedSource?.lastSyncAt?.toISOString() ?? 'N/A'}`);
    console.log(`Documents created:     ${documents.length}`);

    if (updatedSource?.status !== 'active') {
      console.error(`ERROR: Expected source status 'active', got '${updatedSource?.status}'`);
      console.error(`Error message: ${updatedSource?.errorMessage ?? 'none'}`);
      process.exit(1);
    }

    if (documents.length === 0) {
      console.error('ERROR: No documents were created during sync');
      process.exit(1);
    }

    if (args.fullPipeline) {
      console.log('\n--- INGESTION TEST ---');

      for (const doc of documents) {
        console.log(`\nIngesting document: ${doc.id} (${doc.fileName})`);
        const ingestStart = Date.now();
        await handleDocumentIngestion({
          documentId: doc.id,
          tenantId,
          s3Key: doc.sourceKey,
          mimeType: doc.mimeType,
          knowledgeBaseId: kbId,
        });
        console.log(`Ingestion completed in ${Date.now() - ingestStart}ms`);
      }

      const chunkRepo = createDocumentChunkRepository(db);
      const kbRepo = createKnowledgeBaseRepository(db);

      let totalChunks = 0;
      for (const doc of documents) {
        const freshDoc = await db.document.findUnique({ where: { id: doc.id } });
        const chunks = await chunkRepo.findByDocumentId(doc.id, { limit: 1000 });
        totalChunks += chunks.items.length;
        console.log(`Document ${doc.id}: ${chunks.items.length} chunks, status=${freshDoc?.status ?? 'unknown'}`);

        const chunksWithEmbeddings = chunks.items.filter((c: any) => c.embedding != null);
        console.log(`  Chunks with embeddings: ${chunksWithEmbeddings.length}/${chunks.items.length}`);
      }

      const updatedKb = await kbRepo.findById(kbId);
      console.log(`\nKB documentCount: ${updatedKb?.documentCount ?? 0}`);
      console.log(`KB chunkCount:    ${updatedKb?.chunkCount ?? 0}`);

      if (totalChunks === 0) {
        console.error('ERROR: No chunks were created during ingestion');
        process.exit(1);
      }
    }

    console.log('\n=== TEST PASSED ===');

    if (args.cleanup) {
      await cleanupTestData(db, kbId, sourceId);
    }
  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }

    if (args.cleanup && kbId && sourceId) {
      try {
        await cleanupTestData(db, kbId, sourceId);
      } catch {
        // ignore cleanup errors
      }
    }

    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.crawlOnly) {
    await runCrawlOnly(args);
  } else {
    await runSyncAndIngest(args);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
