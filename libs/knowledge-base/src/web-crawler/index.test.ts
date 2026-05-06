import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BreadthFirstCrawler } from './index';
import { WebPageFetcher } from './fetcher';
import { WebPageExtractor } from './extractor';
import { isSameDomain, matchesPatterns, normalizeUrl } from './url-filter';

describe('isSameDomain', () => {
  it('returns true for same protocol and host', () => {
    expect(isSameDomain('https://example.com/a', 'https://example.com/b')).toBe(true);
  });

  it('returns false for different hosts', () => {
    expect(isSameDomain('https://example.com', 'https://other.com')).toBe(false);
  });

  it('returns false for different protocols', () => {
    expect(isSameDomain('http://example.com', 'https://example.com')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isSameDomain('not-a-url', 'https://example.com')).toBe(false);
  });
});

describe('matchesPatterns', () => {
  it('returns true when no patterns are given', () => {
    expect(matchesPatterns('https://example.com/blog', undefined)).toBe(true);
    expect(matchesPatterns('https://example.com/blog', [])).toBe(true);
  });

  it('matches glob wildcards', () => {
    expect(matchesPatterns('https://example.com/blog/post-1', ['*/blog/*'])).toBe(true);
    expect(matchesPatterns('https://example.com/about', ['*/blog/*'])).toBe(false);
  });

  it('matches exact patterns', () => {
    expect(matchesPatterns('https://example.com/blog', ['https://example.com/blog'])).toBe(true);
    expect(matchesPatterns('https://example.com/about', ['https://example.com/blog'])).toBe(false);
  });

  it('matches multiple patterns', () => {
    expect(matchesPatterns('https://example.com/docs', ['*/blog/*', '*/docs'])).toBe(true);
    expect(matchesPatterns('https://example.com/blog/x', ['*/blog/*', '*/docs'])).toBe(true);
  });
});

describe('normalizeUrl', () => {
  it('resolves relative URLs', () => {
    expect(normalizeUrl('/page', 'https://example.com')).toBe('https://example.com/page');
    expect(normalizeUrl('page.html', 'https://example.com/blog/')).toBe('https://example.com/blog/page.html');
  });

  it('strips hash fragments', () => {
    expect(normalizeUrl('https://example.com/page#section', 'https://example.com')).toBe('https://example.com/page');
  });

  it('returns null for non-HTTP(S)', () => {
    expect(normalizeUrl('mailto:test@example.com', 'https://example.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)', 'https://example.com')).toBeNull();
    expect(normalizeUrl('ftp://files.example.com/file.txt', 'https://example.com')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(normalizeUrl('::not-valid::', 'https://example.com')).toBeNull();
  });
});

describe('WebPageExtractor', () => {
  const extractor = new WebPageExtractor();

  it('extracts title from <title>', () => {
    const html = `
      <html><head><title>My Page</title></head>
      <body><p>Hello</p></body>
      </html>`;
    const result = extractor.extract(html);
    expect(result.title).toBe('My Page');
  });

  it('removes scripts and styles', () => {
    const html = `
      <body>
        <script>alert('xss')</script>
        <style>body{color:red}</style>
        <p>Safe text</p>
      </body>`;
    const result = extractor.extract(html);
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('color');
    expect(result.text).toContain('Safe text');
  });

  it('extracts absolute links', () => {
    const html = `
      <body>
        <a href="https://example.com/a">A</a>
        <a href="/relative">R</a>
        <a href="mailto:x@y.com">M</a>
      </body>`;
    const result = extractor.extract(html);
    expect(result.links).toContain('https://example.com/a');
    expect(result.links).not.toContain('/relative');
    expect(result.links).not.toContain('mailto:x@y.com');
  });

  it('prefers article/main over body', () => {
    const html = `
      <body>
        <header>Header</header>
        <main>Main Content</main>
        <footer>Footer</footer>
      </body>`;
    const result = extractor.extract(html);
    expect(result.text).toContain('Main Content');
    expect(result.text).not.toContain('Header');
    expect(result.text).not.toContain('Footer');
  });
});

describe('BreadthFirstCrawler', () => {
  let fetcher: WebPageFetcher;
  let extractor: WebPageExtractor;
  let crawler: BreadthFirstCrawler;

  beforeEach(() => {
    fetcher = new WebPageFetcher(0);
    extractor = new WebPageExtractor();
    crawler = new BreadthFirstCrawler(fetcher, extractor);
    vi.restoreAllMocks();
  });

  it('respects depth limit', async () => {
    const pages: Record<string, string> = {
      'https://example.com': `
        <html><body>
          <a href="https://example.com/level1">Level 1</a>
        </body></html>`,
      'https://example.com/level1': `
        <html><body>
          <a href="https://example.com/level2">Level 2</a>
        </body></html>`,
      'https://example.com/level2': `
        <html><body><p>Deep</p></body></html>`,
    };

    vi.spyOn(fetcher, 'fetchPage').mockImplementation(async (url: string) => {
      const html = pages[url] ?? '<html><body><p>Fallback</p></body></html>';
      return { html, status: 200 };
    });

    const result = await crawler.crawl({
      seedUrls: ['https://example.com'],
      crawlDepth: 1,
      maxPages: 10,
      delayMs: 0,
    });

    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://example.com');
    expect(urls).toContain('https://example.com/level1');
    expect(urls).not.toContain('https://example.com/level2');
  });

  it('does not crawl external domains', async () => {
    const pages: Record<string, string> = {
      'https://example.com': `
        <html><body>
          <a href="https://other.com/page">External</a>
        </body></html>`,
    };

    vi.spyOn(fetcher, 'fetchPage').mockImplementation(async (url: string) => {
      const html = pages[url] ?? '<html><body><p>Fallback</p></body></html>';
      return { html, status: 200 };
    });

    const result = await crawler.crawl({
      seedUrls: ['https://example.com'],
      crawlDepth: 2,
      maxPages: 10,
      delayMs: 0,
    });

    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://example.com');
    expect(urls).not.toContain('https://other.com/page');
  });

  it('deduplicates URLs', async () => {
    const pages: Record<string, string> = {
      'https://example.com': `
        <html><body>
          <a href="https://example.com/a">A</a>
          <a href="https://example.com/a">A again</a>
        </body></html>`,
      'https://example.com/a': `
        <html><body><p>Page A</p></body></html>`,
    };

    vi.spyOn(fetcher, 'fetchPage').mockImplementation(async (url: string) => {
      const html = pages[url] ?? '<html><body><p>Fallback</p></body></html>';
      return { html, status: 200 };
    });

    const result = await crawler.crawl({
      seedUrls: ['https://example.com'],
      crawlDepth: 2,
      maxPages: 10,
      delayMs: 0,
    });

    const urls = result.map((r) => r.url);
    expect(urls.filter((u) => u === 'https://example.com/a')).toHaveLength(1);
  });

  it('stops at maxPages', async () => {
    const html = `
      <html><body>
        <a href="https://example.com/1">1</a>
      </body></html>`;

    let callCount = 0;
    vi.spyOn(fetcher, 'fetchPage').mockImplementation(async () => {
      callCount++;
      return { html, status: 200 };
    });

    const result = await crawler.crawl({
      seedUrls: ['https://example.com'],
      crawlDepth: 2,
      maxPages: 3,
      delayMs: 0,
    });

    expect(result.length).toBeLessThanOrEqual(3);
    expect(callCount).toBeLessThanOrEqual(3);
  });

  it('skips pages that fail to fetch', async () => {
    vi.spyOn(fetcher, 'fetchPage').mockImplementation(async (url: string) => {
      if (url === 'https://example.com/bad') {
        throw new Error('Network error');
      }
      return {
        html: `<html><body>
          <a href="https://example.com/bad">Bad</a>
          <p>Good</p>
        </body></html>`,
        status: 200,
      };
    });

    const result = await crawler.crawl({
      seedUrls: ['https://example.com'],
      crawlDepth: 2,
      maxPages: 10,
      delayMs: 0,
    });

    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://example.com');
    expect(urls).not.toContain('https://example.com/bad');
  });
});
