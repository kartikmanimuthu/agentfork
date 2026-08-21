import crypto from 'crypto';
import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger';
import { env } from '../env';

const logger = createLogger('transcription-api-key-service');

const MINUTE_MS = 60_000;

export interface CreateTranscriptionApiKeyInput {
  name: string;
  jobConfigId?: string | null;
  modelId?: string | null;
  dailyReqLimit?: number;
  dailyMinutesLimit?: number;
  minuteReqLimit?: number;
  scopes?: string[];
  expiresAt?: Date;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  createdBy: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remainingRequests?: number;
  remainingMinutes?: number;
  retryAfter?: number;
}

/**
 * API keys for the external transcription API, plus per-key quota tracking.
 * Mirrors {@link ApiKeyService} (sk_ prefix, sha256 hash, stored prefix) and folds
 * in the sliding-window logic from {@link QuotaService} against transcription usage.
 */
export class TranscriptionApiKeyService {
  private readonly prisma: PrismaClient;

  constructor(
    private readonly tenantId: string,
    prisma: PrismaClient = getPrismaClient()
  ) {
    this.prisma = prisma;
  }

  private generateRawKey(): string {
    return 'sk_' + crypto.randomBytes(36).toString('base64url');
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  async create(input: CreateTranscriptionApiKeyInput) {
    const rawKey = this.generateRawKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);

    const apiKey = await this.prisma.transcriptionApiKey.create({
      data: {
        tenantId: this.tenantId,
        jobConfigId: input.jobConfigId ?? null,
        modelId: input.modelId ?? null,
        name: input.name,
        keyHash,
        keyPrefix,
        status: 'active',
        scopes: input.scopes ?? ['transcription:write'],
        dailyReqLimit: input.dailyReqLimit ?? env.TRANSCRIPTION_DEFAULT_DAILY_REQ_LIMIT,
        dailyMinutesLimit: input.dailyMinutesLimit ?? env.TRANSCRIPTION_DEFAULT_DAILY_MINUTES_LIMIT,
        minuteReqLimit: input.minuteReqLimit ?? env.TRANSCRIPTION_DEFAULT_MINUTE_REQ_LIMIT,
        webhookUrl: input.webhookUrl ?? null,
        webhookSecret: input.webhookSecret ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy,
      },
    });

    logger.info({ tenantId: this.tenantId, apiKeyId: apiKey.id }, 'Transcription API key created');
    return { rawKey, apiKey };
  }

  async list(filters?: { status?: string; jobConfigId?: string }) {
    return this.prisma.transcriptionApiKey.findMany({
      where: {
        tenantId: this.tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.jobConfigId ? { jobConfigId: filters.jobConfigId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.transcriptionApiKey.findFirst({
      where: { id, tenantId: this.tenantId },
    });
  }

  async revoke(id: string) {
    return this.prisma.transcriptionApiKey.update({
      where: { id, tenantId: this.tenantId },
      data: { status: 'revoked', updatedAt: new Date() },
    });
  }

  async rotate(id: string, gracePeriodHours = 24) {
    const oldKey = await this.prisma.transcriptionApiKey.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!oldKey) throw new Error('Transcription API key not found');

    await this.prisma.transcriptionApiKey.update({
      where: { id, tenantId: this.tenantId },
      data: {
        status: 'rotating',
        expiresAt: new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
    });

    return this.create({
      name: `${oldKey.name} (rotated)`,
      modelId: oldKey.modelId,
      dailyReqLimit: oldKey.dailyReqLimit,
      dailyMinutesLimit: oldKey.dailyMinutesLimit,
      minuteReqLimit: oldKey.minuteReqLimit,
      scopes: oldKey.scopes,
      webhookUrl: oldKey.webhookUrl,
      webhookSecret: oldKey.webhookSecret,
      createdBy: oldKey.createdBy,
    });
  }

  async delete(id: string) {
    return this.prisma.transcriptionApiKey.delete({
      where: { id, tenantId: this.tenantId },
    });
  }

  /** Generate (or rotate) a new webhook signing secret for the given key. Returns the raw
   *  secret ONCE — store it safely, it cannot be retrieved again. */
  async rotateWebhookSecret(id: string): Promise<{ rawSecret: string; hasSecret: boolean }> {
    const key = await this.prisma.transcriptionApiKey.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!key) throw new Error('Transcription API key not found');

    const rawSecret = 'whsec_' + crypto.randomBytes(32).toString('base64url');
    await this.prisma.transcriptionApiKey.update({
      where: { id, tenantId: this.tenantId },
      data: { webhookSecret: rawSecret, updatedAt: new Date() },
    });
    logger.info({ tenantId: this.tenantId, apiKeyId: id }, 'Webhook secret rotated');
    return { rawSecret, hasSecret: true };
  }

  /** Returns whether a webhook secret is configured (never returns the raw value). */
  async getWebhookSecretStatus(id: string): Promise<{ hasSecret: boolean; hint: string | null }> {
    const key = await this.prisma.transcriptionApiKey.findFirst({
      where: { id, tenantId: this.tenantId },
      select: { webhookSecret: true },
    });
    if (!key) throw new Error('Transcription API key not found');
    return {
      hasSecret: Boolean(key.webhookSecret),
      hint: key.webhookSecret ? `${key.webhookSecret.slice(0, 10)}...` : null,
    };
  }

  // ─── Quota ────────────────────────────────────────────────────────────────
  private getTodayDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  /** Static helper (no tenant scope) for the quota primitives, keyed by apiKeyId. */
  static async checkQuota(
    prisma: PrismaClient,
    apiKeyId: string,
    limits: { dailyReqLimit: number; dailyMinutesLimit: number; minuteReqLimit: number }
  ): Promise<QuotaCheckResult> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const usage = await prisma.transcriptionApiKeyUsage.findFirst({
      where: { apiKeyId, date: today },
    });

    const requestCount = usage?.requestCount ?? 0;
    const minutesCount = usage?.minutesCount ?? 0;

    if (requestCount >= limits.dailyReqLimit) {
      return {
        allowed: false,
        reason: `Daily request limit of ${limits.dailyReqLimit} exceeded.`,
        remainingRequests: 0,
        remainingMinutes: Math.max(0, limits.dailyMinutesLimit - minutesCount),
      };
    }

    if (minutesCount >= limits.dailyMinutesLimit) {
      return {
        allowed: false,
        reason: `Daily audio-minutes limit of ${limits.dailyMinutesLimit} exceeded.`,
        remainingRequests: Math.max(0, limits.dailyReqLimit - requestCount),
        remainingMinutes: 0,
      };
    }

    let minuteCount = usage?.minuteReqCount ?? 0;
    const minuteResetAt = usage?.minuteResetAt ?? new Date(0);
    if (now.getTime() - new Date(minuteResetAt).getTime() > MINUTE_MS) {
      minuteCount = 0;
    }

    if (minuteCount >= limits.minuteReqLimit) {
      const retryAfter = Math.ceil(
        (MINUTE_MS - (now.getTime() - new Date(minuteResetAt).getTime())) / 1000
      );
      return {
        allowed: false,
        reason: `Rate limit of ${limits.minuteReqLimit} requests per minute exceeded.`,
        remainingRequests: Math.max(0, limits.dailyReqLimit - requestCount),
        remainingMinutes: Math.max(0, limits.dailyMinutesLimit - minutesCount),
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      remainingRequests: limits.dailyReqLimit - requestCount,
      remainingMinutes: limits.dailyMinutesLimit - minutesCount,
    };
  }

  static async reserveRequest(prisma: PrismaClient, apiKeyId: string): Promise<void> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const existing = await prisma.transcriptionApiKeyUsage.findFirst({
      where: { apiKeyId, date: today },
    });
    const shouldResetMinute =
      !existing || now.getTime() - new Date(existing.minuteResetAt).getTime() > MINUTE_MS;

    await prisma.transcriptionApiKeyUsage.upsert({
      where: { apiKeyId_date: { apiKeyId, date: today } },
      create: {
        apiKeyId,
        date: today,
        requestCount: 1,
        minutesCount: 0,
        minuteReqCount: 1,
        minuteResetAt: now,
      },
      update: {
        requestCount: { increment: 1 },
        ...(shouldResetMinute
          ? { minuteReqCount: 1, minuteResetAt: now }
          : { minuteReqCount: { increment: 1 } }),
      },
    });
  }

  static async recordAudioMinutes(prisma: PrismaClient, apiKeyId: string, audioMinutes: number): Promise<void> {
    if (audioMinutes <= 0) return;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    await prisma.transcriptionApiKeyUsage.upsert({
      where: { apiKeyId_date: { apiKeyId, date: today } },
      create: {
        apiKeyId,
        date: today,
        requestCount: 0,
        minutesCount: audioMinutes,
        minuteReqCount: 0,
        minuteResetAt: now,
      },
      update: {
        minutesCount: { increment: audioMinutes },
      },
    });
  }

  async getUsage(apiKeyId: string): Promise<{ requestCount: number; minutesCount: number }> {
    const today = this.getTodayDate();
    const usage = await this.prisma.transcriptionApiKeyUsage.findFirst({
      where: { apiKeyId, date: today },
    });
    return {
      requestCount: usage?.requestCount ?? 0,
      minutesCount: usage?.minutesCount ?? 0,
    };
  }
}
