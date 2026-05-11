import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { EncryptionService } from './encryption-service';
import { createLogger } from '../logging/logger';
import type { CreateLlmProviderInput, UpdateLlmProviderInput, ValidateLlmProviderInput } from '../validation/schemas/llm-provider';

const logger = createLogger('llm-provider-service');

export interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: string[];
}

export type DiscoverFn = (
  providerType: string,
  credentials: Record<string, string>,
  region?: string
) => Promise<DiscoveredModel[]>;

export interface LlmProviderResponse {
  id: string;
  tenantId: string;
  name: string;
  providerType: string;
  region: string | null;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  models: unknown;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class LlmProviderService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;
  private readonly encryption: EncryptionService;

  constructor(tenantId: string) {
    this.prisma = getPrismaClient();
    this.tenantId = tenantId;
    this.encryption = new EncryptionService();
  }

  async list(): Promise<LlmProviderResponse[]> {
    const rows = await this.prisma.llmProvider.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: string): Promise<LlmProviderResponse | null> {
    const row = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    return row ? this.toResponse(row) : null;
  }

  async create(input: CreateLlmProviderInput) {
    if (input.isDefault) await this.clearDefault();

    const encryptedCredentials = input.credentials
      ? this.encryption.encrypt(JSON.stringify(input.credentials))
      : null;

    logger.info(
      { tenantId: this.tenantId, name: input.name, providerType: input.providerType, isDefault: input.isDefault },
      'Creating LLM provider record'
    );

    const row = await this.prisma.llmProvider.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        providerType: input.providerType,
        region: input.region ?? null,
        credentials: encryptedCredentials,
        chatModel: input.chatModel ?? null,
        embeddingModel: input.embeddingModel ?? null,
        embeddingDimensions: input.embeddingDimensions ?? null,
        isDefault: input.isDefault ?? false,
      },
    });
    logger.info({ tenantId: this.tenantId, providerId: row.id }, 'Created LLM provider record');
    return this.toResponse(row);
  }

  async update(id: string, input: UpdateLlmProviderInput) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    if (input.isDefault) await this.clearDefault();

    let encryptedCredentials = existing.credentials;
    if (input.credentials) {
      encryptedCredentials = this.encryption.encrypt(JSON.stringify(input.credentials));
    }

    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: {
        name: input.name,
        providerType: input.providerType,
        region: input.region ?? existing.region,
        credentials: encryptedCredentials,
        chatModel: input.chatModel ?? existing.chatModel,
        embeddingModel: input.embeddingModel ?? existing.embeddingModel,
        embeddingDimensions: input.embeddingDimensions ?? existing.embeddingDimensions,
        isDefault: input.isDefault ?? existing.isDefault,
      },
    });
    logger.info({ tenantId: this.tenantId, providerId: row.id }, 'Updated LLM provider record');
    return this.toResponse(row);
  }

  async delete(id: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;
    logger.info({ tenantId: this.tenantId, providerId: id }, 'Deleting LLM provider record');
    return this.prisma.llmProvider.delete({ where: { id } });
  }

  async setDefault(id: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    await this.clearDefault();
    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: { isDefault: true },
    });
    logger.info({ tenantId: this.tenantId, providerId: id }, 'Set default LLM provider');
    return this.toResponse(row);
  }

  async validateAndDiscoverModels(input: ValidateLlmProviderInput, discover: DiscoverFn) {
    logger.info(
      { tenantId: this.tenantId, providerType: input.providerType, region: input.region, baseUrl: input.credentials?.baseUrl, hasApiKey: !!input.credentials?.apiKey },
      'Starting provider validation and model discovery'
    );
    const models = await discover(
      input.providerType,
      input.credentials as Record<string, string>,
      input.region
    );
    logger.info(
      { tenantId: this.tenantId, providerType: input.providerType, modelCount: models.length },
      'Provider validation completed'
    );
    return { success: true as const, models };
  }

  async refreshModels(id: string, discover: DiscoverFn) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    const credentials = existing.credentials
      ? JSON.parse(this.encryption.decrypt(existing.credentials))
      : {};

    logger.info(
      { tenantId: this.tenantId, providerId: id, providerType: existing.providerType },
      'Refreshing models for provider'
    );
    const models = await discover(existing.providerType, credentials, existing.region ?? undefined);

    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: { models: { models } as any },
    });
    logger.info(
      { tenantId: this.tenantId, providerId: id, modelCount: models.length },
      'Refreshed models for provider'
    );
    return this.toResponse(row);
  }

  async getDefaultConfig() {
    const row = await this.prisma.llmProvider.findFirst({
      where: { tenantId: this.tenantId, isDefault: true },
    });
    if (!row) {
      logger.info({ tenantId: this.tenantId }, 'No default LLM provider configured');
      return null;
    }
    return this.buildConfig(row);
  }

  async getConfigById(id: string) {
    const row = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!row) {
      logger.info({ tenantId: this.tenantId, providerId: id }, 'Provider not found for config resolution');
      return null;
    }
    return this.buildConfig(row);
  }

  private buildConfig(row: any) {
    const credentials = row.credentials
      ? JSON.parse(this.encryption.decrypt(row.credentials))
      : undefined;

    const config = {
      provider: row.providerType.toLowerCase() as any,
      chatModel: row.chatModel ?? undefined,
      embeddingModel: row.embeddingModel ?? undefined,
      embeddingDimensions: row.embeddingDimensions ?? undefined,
      baseUrl: credentials?.baseUrl,
      apiKey: credentials?.apiKey,
      accessKeyId: credentials?.accessKeyId,
      secretAccessKey: credentials?.secretAccessKey,
      region: row.region ?? undefined,
    };
    logger.info(
      { tenantId: this.tenantId, providerId: row.id, providerType: row.providerType, chatModel: config.chatModel },
      'Resolved LLM config'
    );
    return config;
  }

  private async clearDefault() {
    await this.prisma.llmProvider.updateMany({
      where: { tenantId: this.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private toResponse(row: any): LlmProviderResponse {
    let credentialsConfigured = false;
    let credentialsHint: string | null = null;

    if (row.credentials) {
      try {
        const decrypted = JSON.parse(this.encryption.decrypt(row.credentials));
        credentialsConfigured = true;
        const key = decrypted.apiKey ?? decrypted.accessKeyId;
        if (key && key.length > 6) {
          credentialsHint = `${key.slice(0, 3)}...${key.slice(-3)}`;
        }
      } catch {
        credentialsConfigured = true;
      }
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      providerType: row.providerType,
      region: row.region,
      credentialsConfigured,
      credentialsHint,
      chatModel: row.chatModel,
      embeddingModel: row.embeddingModel,
      embeddingDimensions: row.embeddingDimensions,
      models: row.models,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
