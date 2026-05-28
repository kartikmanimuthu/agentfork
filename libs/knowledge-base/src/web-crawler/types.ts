export interface CrawlOptions {
  seedUrls: string[];
  crawlDepth: number; // 0-3
  includePatterns?: string[];
  excludePatterns?: string[];
  maxPages?: number; // default 50
  /** Use headless browser for JS-heavy sites */
  useHeadless?: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  /** Clean Markdown extracted from the page */
  markdown: string;
  /** Length of the Markdown string (includes syntax characters) */
  textLength: number;
  fetchedAt: Date;
}

export interface WebCrawler {
  crawl(options: CrawlOptions): Promise<CrawledPage[]>;
}
