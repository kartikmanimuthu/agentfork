import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { EncryptionService } from './encryption-service';
import type { CreateLlmProviderInput, UpdateLlmProviderInput, ValidateLlmProviderInput } from '../validation/schemas/llm-provider';

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
    return this.toResponse(row);
  }

  async delete(id: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;
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
    return this.toResponse(row);
  }

  async validateAndDiscoverModels(input: ValidateLlmProviderInput, discover: DiscoverFn) {
    const models = await discover(
      input.providerType,
      input.credentials as Record<string, string>,
      input.region
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

    const models = await discover(existing.providerType, credentials, existing.region ?? undefined);

    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: { models: { models } as any },
    });
    return this.toResponse(row);
  }

  async getDefaultConfig() {
    const row = await this.prisma.llmProvider.findFirst({
      where: { tenantId: this.tenantId, isDefault: true },
    });
    if (!row) return null;

    const credentials = row.credentials
      ? JSON.parse(this.encryption.decrypt(row.credentials))
      : undefined;

    return {
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
