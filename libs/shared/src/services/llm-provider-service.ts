import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
// Local type to avoid cross-project import
interface LlmProviderConfig {
  provider: 'bedrock' | 'openai';
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface CreateLlmProviderInput {
  name: string;
  provider: string;
  chatModel?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  isDefault?: boolean;
}

export interface UpdateLlmProviderInput {
  name?: string;
  provider?: string;
  chatModel?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  isDefault?: boolean;
}

export class LlmProviderService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;

  constructor(tenantId: string) {
    this.prisma = getPrismaClient();
    this.tenantId = tenantId;
  }

  async list() {
    return this.prisma.llmProvider.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string) {
    return this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
  }

  async create(input: CreateLlmProviderInput) {
    if (input.isDefault) {
      await this.clearDefault();
    }
    return this.prisma.llmProvider.create({
      data: {
        ...input,
        tenantId: this.tenantId,
      },
    });
  }

  async update(id: string, input: UpdateLlmProviderInput) {
    const existing = await this.findById(id);
    if (!existing) return null;

    if (input.isDefault) {
      await this.clearDefault();
    }

    return this.prisma.llmProvider.update({
      where: { id },
      data: input,
    });
  }

  async delete(id: string) {
    const existing = await this.findById(id);
    if (!existing) return null;

    return this.prisma.llmProvider.delete({
      where: { id },
    });
  }

  async setDefault(id: string) {
    const existing = await this.findById(id);
    if (!existing) return null;

    await this.clearDefault();
    return this.prisma.llmProvider.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  async getDefaultConfig(): Promise<LlmProviderConfig | null> {
    const defaultProvider = await this.prisma.llmProvider.findFirst({
      where: { tenantId: this.tenantId, isDefault: true },
    });

    if (!defaultProvider) return null;

    return {
      provider: defaultProvider.provider as 'bedrock' | 'openai',
      chatModel: defaultProvider.chatModel ?? undefined,
      embeddingModel: defaultProvider.embeddingModel ?? undefined,
      embeddingDimensions: defaultProvider.embeddingDimensions ?? undefined,
      baseUrl: defaultProvider.baseUrl ?? undefined,
      apiKey: defaultProvider.apiKey ?? undefined,
    };
  }

  private async clearDefault() {
    await this.prisma.llmProvider.updateMany({
      where: { tenantId: this.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
