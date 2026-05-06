export interface CrawlOptions {
  seedUrls: string[];
  crawlDepth: number; // 0-3
  includePatterns?: string[];
  excludePatterns?: string[];
  maxPages?: number; // default 50
  delayMs?: number; // default 500
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  links: string[];
  fetchedAt: Date;
}

export interface WebCrawler {
  crawl(options: CrawlOptions): Promise<CrawledPage[]>;
}
