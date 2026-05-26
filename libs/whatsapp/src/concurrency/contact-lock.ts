export interface LockProvider {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export class InMemoryLockProvider implements LockProvider {
  private readonly locks = new Map<string, number>();

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

export class ContactLock {
  private readonly provider: LockProvider;
  private readonly ttlMs: number;

  constructor(provider: LockProvider, ttlMs = 60_000) {
    this.provider = provider;
    this.ttlMs = ttlMs;
  }

  async acquire(accountId: string, contactPhone: string): Promise<boolean> {
    const key = `wa:lock:${accountId}:${contactPhone}`;
    return this.provider.acquire(key, this.ttlMs);
  }

  async release(accountId: string, contactPhone: string): Promise<void> {
    const key = `wa:lock:${accountId}:${contactPhone}`;
    return this.provider.release(key);
  }
}
