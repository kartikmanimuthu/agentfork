import {
  CheerioCrawler,
  PlaywrightCrawler,
  RequestQueue,
  Configuration,
} from 'crawlee';
import { createLogger } from '@chatbot/shared/workers';
import { kbEnv } from '../env';
import type { CrawlOptions, CrawledPage } from './types';
import { extractMarkdownFromHtml } from './extraction';

const engineLogger = createLogger('kb:web-crawler:engine');

// Configure Crawlee to use a temporary storage directory
// so the worker does not accumulate on-disk queues between restarts.
Configuration.set(
  'storageClientOptions',
  { storageDir: kbEnv.CRAWLEE_STORAGE_DIR ?? '/tmp/crawlee-storage' }
);

export async function runCrawleeCrawl(options: CrawlOptions): Promise<CrawledPage[]> {
  const {
    seedUrls,
    crawlDepth,
    includePatterns,
    excludePatterns,
    maxPages = 50,
    useHeadless = true,
  } = options;

  engineLogger.info(
    { seedUrls, crawlDepth, maxPages, useHeadless },
    'Starting Crawlee crawl'
  );

  const results: CrawledPage[] = [];
  const requestQueue = await RequestQueue.open(`kb-crawl-${Date.now()}`);

  // Seed initial requests
  for (const url of seedUrls) {
    await requestQueue.addRequest({ url, label: 'page', userData: { depth: 0 } });
  }

  const sharedConfig = {
    requestQueue,
    maxRequestsPerCrawl: maxPages,
    respectRobotsTxtFile: true,
    keepAlive: false,
  };

  const handlePage = async (url: string, html: string, _depth: number): Promise<void> => {
    try {
      const extraction = extractMarkdownFromHtml(html, url);

      if (extraction.markdown.trim().length === 0) {
        engineLogger.warn({ url }, 'Empty markdown after extraction; skipping page');
        return;
      }

      results.push({
        url,
        title: extraction.title,
        markdown: extraction.markdown,
        textLength: extraction.markdown.length,
        fetchedAt: new Date(),
      });

      engineLogger.debug(
        { url, title: extraction.title, markdownLength: extraction.markdown.length },
        'Page extracted'
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      engineLogger.error({ url, errorMessage: error.message }, 'Page extraction failed');
    }
  };

  const enqueueLinksConfig = {
    globs: includePatterns?.length ? includePatterns : undefined,
    exclude: excludePatterns?.length ? excludePatterns : undefined,
    strategy: 'same-domain' as const,
    transformRequestFunction(req: { url: string; userData?: Record<string, unknown> }) {
      const userData = req.userData ?? {};
      const parentDepth = (userData.depth as number) ?? 0;
      if (parentDepth + 1 > crawlDepth) {
        return false;
      }
      req.userData = { ...userData, depth: parentDepth + 1 };
      return req;
    },
  };

  try {
    if (useHeadless) {
      const crawler = new PlaywrightCrawler({
        ...sharedConfig,
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 120,
        headless: true,
        async requestHandler({ page, request, enqueueLinks }) {
          await page.waitForLoadState('networkidle');
          const html = await page.content();
          const depth = (request.userData?.depth as number) ?? 0;
          await handlePage(request.url, html, depth);
          if (depth < crawlDepth) {
            await enqueueLinks(enqueueLinksConfig);
          }
        },
      });
      await crawler.run();
    } else {
      const crawler = new CheerioCrawler({
        ...sharedConfig,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,
        async requestHandler({ $, request, enqueueLinks }) {
          const html = $.html();
          const depth = (request.userData?.depth as number) ?? 0;
          await handlePage(request.url, html, depth);
          if (depth < crawlDepth) {
            await enqueueLinks(enqueueLinksConfig);
          }
        },
      });
      await crawler.run();
    }
  } finally {
    // Clean up the request queue directory to prevent /tmp accumulation
    try {
      await requestQueue.drop();
      engineLogger.debug({}, 'Crawlee request queue cleaned up');
    } catch (cleanupErr) {
      const error = cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr));
      engineLogger.warn({ errorMessage: error.message }, 'Failed to clean up Crawlee request queue');
    }
  }

  engineLogger.info({ crawledCount: results.length }, 'Crawl complete');
  return results;
}
