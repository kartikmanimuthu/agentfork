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
  estimatedTokens?: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remainingRequests?: number;
  remainingTokens?: number;
}

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
    const usage = await this.db.apiKeyUsage.findFirst({
      where: { apiKeyId: this.apiKeyId, date: today },
    }) as { requestCount: number; tokenCount: number } | null;

    const requestCount = usage?.requestCount ?? 0;
    const tokenCount = usage?.tokenCount ?? 0;
    const estimatedTokens = input.estimatedTokens ?? 0;

    if (requestCount >= input.dailyReqLimit) {
      return {
        allowed: false,
        reason: `Daily request limit of ${input.dailyReqLimit} exceeded.`,
        remainingRequests: 0,
        remainingTokens: input.dailyTokenLimit - tokenCount,
      };
    }

    if (tokenCount + estimatedTokens > input.dailyTokenLimit) {
      return {
        allowed: false,
        reason: `Daily token limit of ${input.dailyTokenLimit} exceeded.`,
        remainingRequests: input.dailyReqLimit - requestCount,
        remainingTokens: 0,
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
    await this.db.apiKeyUsage.upsert({
      where: { apiKeyId_date: { apiKeyId: this.apiKeyId, date: today } },
      create: {
        apiKeyId: this.apiKeyId,
        date: today,
        requestCount: 1,
        tokenCount: tokens,
      },
      update: {
        requestCount: { increment: 1 },
        tokenCount: { increment: tokens },
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
