import pino from 'pino';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const logger = pino({ name: 'ai:web-fetch' });

const DEFAULT_MAX_LENGTH = 8000;
const NAVIGATION_TIMEOUT_MS = 15000;

// Realistic user agent to avoid bot-detection 404s from news sites and CDNs
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WebFetchOptions {
  url: string;
  maxLength?: number;
}

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Core fetch logic
// ---------------------------------------------------------------------------

export async function fetchWebPage(options: WebFetchOptions): Promise<WebFetchResult> {
  const { url, maxLength = DEFAULT_MAX_LENGTH } = options;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  logger.info({ url, maxLength }, 'Web fetch started');

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    page = await context.newPage();

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    if (!response) {
      throw new Error(`Failed to navigate to ${url}: no response`);
    }

    if (response.status() >= 400) {
      throw new Error(`HTTP ${response.status()} when fetching ${url}`);
    }

    const title = await page.title().catch(() => '');

    // Extract visible text content from the page body. This callback is
    // serialized and executed in the browser context, where DOM globals exist;
    // they are not part of the Node lib, so we reference them loosely.
    const rawText = await page.evaluate(() => {
      const doc = (globalThis as { document?: { body?: unknown } }).document;
      const body = doc?.body as
        | { cloneNode: (deep: boolean) => { querySelectorAll: (s: string) => Array<{ remove: () => void }>; innerText?: string } }
        | undefined;
      if (!body) return '';
      // Remove script/style/noscript tags to avoid noise
      const clone = body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, nav, footer, iframe').forEach((el) => el.remove());
      return clone.innerText || '';
    });

    // Normalize whitespace
    const cleaned = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const truncated = cleaned.length > maxLength;
    const content = cleaned.slice(0, maxLength);

    logger.info({ url, title, contentLength: content.length, truncated, status: response.status() }, 'Web fetch completed');

    return { url, title, content, contentLength: content.length, truncated };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ url, errorMessage: error.message }, 'Web fetch failed');
    throw error;
  } finally {
    try {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (closeErr) {
      logger.warn({ url, errorMessage: (closeErr as Error).message }, 'Browser cleanup warning');
    }
  }
}

// ---------------------------------------------------------------------------
// ToolSet entry
// ---------------------------------------------------------------------------

export function buildWebFetchTool(): ToolSet {
  return {
    web_fetch: tool({
      description:
        'Fetch and read the content of a web page. Provide a full URL. Returns the page title and visible text content. Use this when the user references a specific URL or when search results need deeper reading.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch' },
          maxLength: {
            type: 'number',
            description: `Maximum characters to return (default ${DEFAULT_MAX_LENGTH})`,
            minimum: 100,
            maximum: 20000,
          },
        },
        required: ['url'],
      }),
      execute: async (args: unknown) => {
        const { url, maxLength } = args as { url: string; maxLength?: number };
        logger.debug({ url, maxLength }, 'web_fetch tool invoked by model');
        try {
          const result = await fetchWebPage({ url, maxLength });
          logger.debug(
            { url, title: result.title, contentLength: result.contentLength, truncated: result.truncated },
            'web_fetch tool completed',
          );
          return {
            title: result.title,
            url: result.url,
            content: result.content,
            truncated: result.truncated,
            contentLength: result.contentLength,
          };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error({ url, errorMessage: error.message }, 'web_fetch tool execution failed');
          return { error: error.message, url };
        }
      },
    }),
  };
}
