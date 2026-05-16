import type { CrawlOptions, CrawledPage, WebCrawler } from './types';
import { WebPageFetcher } from './fetcher';
import { WebPageExtractor } from './extractor';
import { isSameDomain, matchesPatterns, normalizeUrl } from './url-filter';

interface QueueItem {
  url: string;
  depth: number;
}

export class BreadthFirstCrawler implements WebCrawler {
  constructor(
    private fetcher: WebPageFetcher,
    private extractor: WebPageExtractor
  ) {}

  async crawl(options: CrawlOptions): Promise<CrawledPage[]> {
    const {
      seedUrls,
      crawlDepth,
      includePatterns,
      excludePatterns,
      maxPages = 50,
      delayMs,
    } = options;

    const results: CrawledPage[] = [];
    const visited = new Set<string>();
    const queue: QueueItem[] = seedUrls.map((url) => ({ url, depth: 0 }));

    // Seed domains for same-domain restriction
    const seedDomains = new Set(
      seedUrls
        .map((u) => {
          try {
            return new URL(u).hostname;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as string[]
    );

    while (queue.length > 0 && results.length < maxPages) {
      const { url, depth } = queue.shift()!;

      if (visited.has(url) || depth > crawlDepth) {
        continue;
      }

      if (!matchesPatterns(url, includePatterns)) {
        continue;
      }

      if (excludePatterns && excludePatterns.length > 0 && matchesPatterns(url, excludePatterns)) {
        continue;
      }

      try {
        const { html } = await this.fetcher.fetchPage(url);
        const { title, text, links } = this.extractor.extract(html);
        const fetchedAt = new Date();

        visited.add(url);
        results.push({ url, title, text, links, fetchedAt });

        // Enqueue same-domain links
        for (const rawLink of links) {
          const normalized = normalizeUrl(rawLink, url);
          if (!normalized || visited.has(normalized)) {
            continue;
          }

          const linkHost = new URL(normalized).hostname;
          if (!seedDomains.has(linkHost)) {
            continue;
          }

          if (!matchesPatterns(normalized, includePatterns)) {
            continue;
          }

          if (excludePatterns && excludePatterns.length > 0 && matchesPatterns(normalized, excludePatterns)) {
            continue;
          }

          queue.push({ url: normalized, depth: depth + 1 });
        }
      } catch {
        // Silently skip unreachable pages so crawling continues
        visited.add(url);
      }
    }

    return results;
  }
}

export interface CrawlerFactoryOptions {
  delayMs?: number;
}

export function createWebCrawler(options: CrawlerFactoryOptions = {}): WebCrawler {
  const fetcher = new WebPageFetcher(options.delayMs ?? 500);
  const extractor = new WebPageExtractor();
  return new BreadthFirstCrawler(fetcher, extractor);
}

export * from './types';
export * from './url-filter';
export * from './fetcher';
export * from './extractor';
