export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export class InMemoryRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async check(accountId: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const key = `wa:rate:${accountId}`;
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetAt: new Date(now + windowMs) };
    }

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: new Date(existing.resetAt) };
    }

    existing.count++;
    return { allowed: true, remaining: limit - existing.count, resetAt: new Date(existing.resetAt) };
  }
}
