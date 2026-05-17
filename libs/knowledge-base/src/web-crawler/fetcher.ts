import { createLogger } from '@chatbot/shared/workers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetcherLogger = createLogger('kb:web-crawler:fetcher');

export interface FetchResult {
  html: string;
  status: number;
}

export class WebPageFetcher {
  private lastFetchAt = 0;

  constructor(private delayMs: number = 500) {}

  async fetchPage(url: string): Promise<FetchResult> {
    const now = Date.now();
    const elapsed = now - this.lastFetchAt;
    if (elapsed < this.delayMs) {
      await sleep(this.delayMs - elapsed);
    }

    try {
      const response = await this.fetchWithRedirects(url, 0);
      this.lastFetchAt = Date.now();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const html = await response.text();
      fetcherLogger.debug({ url, status: response.status, htmlLength: html.length }, 'Fetched page');
      return { html, status: response.status };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      fetcherLogger.error({ url, errorMessage: error.message, errorStack: error.stack }, 'Failed to fetch page');
      throw error;
    }
  }

  private async fetchWithRedirects(url: string, hops: number): Promise<Response> {
    if (hops >= 5) {
      fetcherLogger.warn({ url, hops }, 'Too many redirects');
      throw new Error(`Too many redirects for ${url}`);
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ChatbotKB/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });

    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      const location = response.headers.get('location')!;
      const resolved = new URL(location, url).href;
      fetcherLogger.debug({ url, resolved, hops }, 'Following redirect');
      return this.fetchWithRedirects(resolved, hops + 1);
    }

    return response;
  }
}
