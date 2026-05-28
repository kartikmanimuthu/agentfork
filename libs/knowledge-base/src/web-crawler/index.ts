import { createLogger } from '@chatbot/shared/workers';
import type { CrawlOptions, CrawledPage, WebCrawler } from './types';
import { runCrawleeCrawl } from './crawlee-engine';

const crawlLogger = createLogger('kb:web-crawler');

export class CrawleeWebCrawler implements WebCrawler {
  constructor(private readonly defaultUseHeadless: boolean = true) {}

  async crawl(options: CrawlOptions): Promise<CrawledPage[]> {
    crawlLogger.info(
      { seedUrls: options.seedUrls, crawlDepth: options.crawlDepth },
      'CrawleeWebCrawler.start'
    );
    const mergedOptions: CrawlOptions = {
      ...options,
      useHeadless: options.useHeadless ?? this.defaultUseHeadless,
    };
    const results = await runCrawleeCrawl(mergedOptions);
    crawlLogger.info({ count: results.length }, 'CrawleeWebCrawler.complete');
    return results;
  }
}

export interface CrawlerFactoryOptions {
  /** @deprecated Replaced by Crawlee's internal concurrency controls */
  delayMs?: number;
  useHeadless?: boolean;
}

export function createWebCrawler(options: CrawlerFactoryOptions = {}): WebCrawler {
  return new CrawleeWebCrawler(options.useHeadless);
}

export * from './types';
export * from './extraction';
