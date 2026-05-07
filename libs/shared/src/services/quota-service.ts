export interface QuotaDb {
  apiKeyUsage: {
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface QuotaCheckInput {
  dailyReqLimit: number;
  dailyTokenLimit: number;
  minuteReqLimit?: number;
  estimatedTokens?: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remainingRequests?: number;
  remainingTokens?: number;
  retryAfter?: number;
}

const MINUTE_MS = 60_000;

export class QuotaService {
  constructor(
    private readonly apiKeyId: string,
    private readonly db: QuotaDb
  ) {}

  private getTodayDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  async checkQuota(input: QuotaCheckInput): Promise<QuotaCheckResult> {
    const today = this.getTodayDate();
    const now = new Date();
    const usage = await this.db.apiKeyUsage.findFirst({
      where: { apiKeyId: this.apiKeyId, date: today },
    }) as {
      requestCount: number;
      tokenCount: number;
      minuteReqCount: number;
      minuteResetAt: Date;
    } | null;

    const requestCount = usage?.requestCount ?? 0;
    const tokenCount = usage?.tokenCount ?? 0;
    const estimatedTokens = input.estimatedTokens ?? 0;

    // Check daily request limit
    if (requestCount >= input.dailyReqLimit) {
      return {
        allowed: false,
        reason: `Daily request limit of ${input.dailyReqLimit} exceeded.`,
        remainingRequests: 0,
        remainingTokens: input.dailyTokenLimit - tokenCount,
      };
    }

    // Check daily token limit
    if (tokenCount + estimatedTokens > input.dailyTokenLimit) {
      return {
        allowed: false,
        reason: `Daily token limit of ${input.dailyTokenLimit} exceeded.`,
        remainingRequests: input.dailyReqLimit - requestCount,
        remainingTokens: 0,
      };
    }

    // Check sliding window rate limit (per minute)
    const minuteLimit = input.minuteReqLimit ?? 100;
    let minuteCount = usage?.minuteReqCount ?? 0;
    const minuteResetAt = usage?.minuteResetAt ?? new Date(0);

    // Reset minute counter if more than 1 minute has passed
    if (now.getTime() - new Date(minuteResetAt).getTime() > MINUTE_MS) {
      minuteCount = 0;
    }

    if (minuteCount >= minuteLimit) {
      const retryAfter = Math.ceil(
        (MINUTE_MS - (now.getTime() - new Date(minuteResetAt).getTime())) / 1000
      );
      return {
        allowed: false,
        reason: `Rate limit of ${minuteLimit} requests per minute exceeded. Retry after ${retryAfter}s.`,
        remainingRequests: input.dailyReqLimit - requestCount,
        remainingTokens: input.dailyTokenLimit - tokenCount,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      remainingRequests: input.dailyReqLimit - requestCount,
      remainingTokens: input.dailyTokenLimit - tokenCount,
    };
  }

  async incrementUsage(tokens: number): Promise<void> {
    const today = this.getTodayDate();
    const now = new Date();

    // Get current usage to check if minute counter needs reset
    const existing = await this.db.apiKeyUsage.findFirst({
      where: { apiKeyId: this.apiKeyId, date: today },
    }) as { minuteReqCount: number; minuteResetAt: Date } | null;

    const shouldResetMinute = !existing ||
      now.getTime() - new Date(existing.minuteResetAt).getTime() > MINUTE_MS;

    await this.db.apiKeyUsage.upsert({
      where: { apiKeyId_date: { apiKeyId: this.apiKeyId, date: today } },
      create: {
        apiKeyId: this.apiKeyId,
        date: today,
        requestCount: 1,
        tokenCount: tokens,
        minuteReqCount: 1,
        minuteResetAt: now,
      },
      update: {
        requestCount: { increment: 1 },
        tokenCount: { increment: tokens },
        ...(shouldResetMinute
          ? { minuteReqCount: 1, minuteResetAt: now }
          : { minuteReqCount: { increment: 1 } }
        ),
      },
    });
  }

  async getUsage(): Promise<{ requestCount: number; tokenCount: number }> {
    const today = this.getTodayDate();
    const usage = await this.db.apiKeyUsage.findFirst({
      where: { apiKeyId: this.apiKeyId, date: today },
    }) as { requestCount: number; tokenCount: number } | null;

    return {
      requestCount: usage?.requestCount ?? 0,
      tokenCount: usage?.tokenCount ?? 0,
    };
  }
}
