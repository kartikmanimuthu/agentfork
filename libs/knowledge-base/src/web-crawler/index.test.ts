import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractMarkdownFromHtml } from './extraction';
import { CrawleeWebCrawler } from './index';

// ─── Extraction Pipeline Tests ────────────────────────────────────────────────

describe('extractMarkdownFromHtml', () => {
  it('converts article HTML to markdown', () => {
    const html = `
      <html><head><title>Guide</title></head>
      <body>
        <nav>Menu</nav>
        <article>
          <h1>Hello</h1>
          <p>World</p>
          <ul><li>A</li><li>B</li></ul>
        </article>
      </body>
      </html>`;
    const result = extractMarkdownFromHtml(html, 'https://example.com/guide');
    expect(result.markdown).toMatch(/#{1,2} Hello/);
    expect(result.markdown).toContain('A'); // Turndown produces list items
    expect(result.markdown).not.toContain('<nav>');
    expect(result.title).toBe('Guide');
  });

  it('removes scripts and styles', () => {
    const html = `
      <body>
        <script>alert('xss')</script>
        <style>body{color:red}</style>
        <article><p>Safe text</p></article>
      </body>`;
    const result = extractMarkdownFromHtml(html, 'https://example.com');
    expect(result.markdown).not.toContain('alert');
    expect(result.markdown).not.toContain('color');
    expect(result.markdown).toContain('Safe text');
  });

  it('falls back to body when Readability fails', () => {
    const html = '<html><body><p>Only body</p></body></html>';
    const result = extractMarkdownFromHtml(html, 'https://example.com');
    expect(result.markdown).toContain('Only body');
  });

  it('returns empty for completely empty pages', () => {
    const result = extractMarkdownFromHtml('<html></html>', 'https://example.com');
    expect(result.markdown).toBe('');
  });

  it('preserves links in markdown', () => {
    const html = `
      <article>
        <p>See <a href="https://example.com/a">our docs</a> for more.</p>
      </article>`;
    const result = extractMarkdownFromHtml(html, 'https://example.com');
    expect(result.markdown).toContain('[our docs](https://example.com/a)');
  });

  it('converts code blocks with fences', () => {
    const html = `
      <article>
        <pre><code>const x = 1;</code></pre>
      </article>`;
    const result = extractMarkdownFromHtml(html, 'https://example.com');
    expect(result.markdown).toContain('```');
    expect(result.markdown).toContain('const x = 1;');
  });
});

// ─── CrawleeWebCrawler Tests ────────────────────────────────────────────────
// These are lightweight integration-style tests that validate the CrawleeWebCrawler
// wiring without mocking the full Crawlee internals.

describe('CrawleeWebCrawler', () => {
  let crawler: CrawleeWebCrawler;

  beforeEach(() => {
    crawler = new CrawleeWebCrawler();
    vi.restoreAllMocks();
  });

  it('exists and implements WebCrawler', () => {
    expect(crawler).toBeDefined();
    expect(typeof crawler.crawl).toBe('function');
  });

  it('returns an array of CrawledPage objects', async () => {
    // Since real crawling requires network, we just verify the method signature
    // and that it returns an array. Full integration tests should use the
    // test-kb-sync script against a local HTTP server.
    const result = await crawler.crawl({
      seedUrls: ['https://example.com'],
      crawlDepth: 0,
      maxPages: 1,
      useHeadless: false,
    });

    // Expect an array (might be empty if example.com fails, but type should match)
    expect(Array.isArray(result)).toBe(true);
    for (const page of result) {
      expect(page).toHaveProperty('url');
      expect(page).toHaveProperty('title');
      expect(page).toHaveProperty('markdown');
      expect(page).toHaveProperty('textLength');
      expect(page).toHaveProperty('fetchedAt');
      expect(typeof page.markdown).toBe('string');
      expect(typeof page.textLength).toBe('number');
    }
  });
});
