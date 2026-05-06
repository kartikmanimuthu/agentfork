const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

    const response = await this.fetchWithRedirects(url, 0);
    this.lastFetchAt = Date.now();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const html = await response.text();
    return { html, status: response.status };
  }

  private async fetchWithRedirects(url: string, hops: number): Promise<Response> {
    if (hops >= 5) {
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
      return this.fetchWithRedirects(resolved, hops + 1);
    }

    return response;
  }
}
