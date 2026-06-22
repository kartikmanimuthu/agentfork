export class InMemoryRateLimiter {
  private readonly requests = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor({ windowMs = 60_000, maxRequests = 30 }: { windowMs?: number; maxRequests?: number } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async isAllowed(key: string): Promise<boolean> {
    const now = Date.now();
    const timestamps = this.requests.get(key) ?? [];

    const valid = timestamps.filter((t) => now - t < this.windowMs);
    if (valid.length >= this.maxRequests) {
      this.requests.set(key, valid);
      return false;
    }

    valid.push(now);
    this.requests.set(key, valid);
    return true;
  }
}
