import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { EncryptionService } from './encryption-service';
import { createLogger } from '../logging/logger';
import { env } from '../env';
import type {
  CreateTranscriptionModelInput,
  UpdateTranscriptionModelInput,
  ValidateTranscriptionModelInput,
} from '../validation/schemas/transcription';

const logger = createLogger('transcription-model-service');

export interface DiscoveredTranscriptionModel {
  id: string;
  name: string;
  capabilities: string[];
}

/** Injected discovery fn (from @chatbot/ai createDiscovery) — keeps shared decoupled from ai. */
export type TranscriptionDiscoverFn = (
  providerType: string,
  credentials: Record<string, string>,
  region?: string
) => Promise<DiscoveredTranscriptionModel[]>;

export interface TranscriptionModelResponse {
  id: string;
  tenantId: string;
  name: string;
  providerType: string;
  contract: string;
  endpointUrl: string;
  region: string | null;
  modelId: string | null;
  models: unknown;
  config: unknown;
  activeVersionId: string | null;
  status: string;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Resolved config used by the runner to call the engine. */
export interface TranscriptionModelConfig {
  id: string;
  providerType: string;
  contract: string;
  endpointUrl: string;
  credentials: Record<string, string> | null;
  region: string | null;
  modelId: string | null;
  activeVersionId: string | null;
  resolvedVersionId: string | null;
}

interface TranscriptionModelVersionConfigSnapshot {
  providerType?: string;
  contract?: string;
  endpointUrl?: string;
  region?: string | null;
  modelId?: string | null;
}

/**
 * CRUD + discovery + config resolution for tenant-registered transcription providers.
 * Mirrors {@link LlmProviderService}: credentials are AES-256-GCM encrypted JSON and
 * model discovery is injected as a {@link TranscriptionDiscoverFn}.
 */
export class TranscriptionModelService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;
  private readonly encryption: EncryptionService;

  constructor(tenantId: string, prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
    this.tenantId = tenantId;
    this.encryption = new EncryptionService();
  }

  async list(): Promise<TranscriptionModelResponse[]> {
    const rows = await this.prisma.transcriptionModel.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: string): Promise<TranscriptionModelResponse | null> {
    const row = await this.prisma.transcriptionModel.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    return row ? this.toResponse(row) : null;
  }

  private resolveEndpointUrl(
    providerType: string,
    endpointUrl: string | undefined,
    credentials: Record<string, string> | undefined
  ): string {
    if (endpointUrl) return endpointUrl;
    if (providerType === 'LITELLM') {
      const gatewayUrl = credentials?.gatewayUrl ?? env.LITELLM_GATEWAY_URL;
      if (!gatewayUrl) {
        throw new Error('LiteLLM gateway is not configured (provide a gateway URL, or set LITELLM_GATEWAY_URL)');
      }
      return gatewayUrl;
    }
    throw new Error('A valid endpoint URL is required for this provider type');
  }

  async create(input: CreateTranscriptionModelInput): Promise<TranscriptionModelResponse> {
    if (input.isDefault) await this.clearDefault();

    const providerType = input.providerType ?? 'CUSTOM';
    const endpointUrl = this.resolveEndpointUrl(providerType, input.endpointUrl, input.credentials);
    const encryptedCredentials = input.credentials
      ? this.encryption.encrypt(JSON.stringify(input.credentials))
      : null;

    const row = await this.prisma.transcriptionModel.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        providerType,
        contract: input.contract ?? 'custom',
        endpointUrl,
        credentials: encryptedCredentials,
        region: input.region ?? null,
        modelId: input.modelId ?? null,
        models: input.models ? ({ models: input.models } as never) : undefined,
        config: (input.config ?? null) as never,
        isDefault: input.isDefault ?? false,
      },
    });
    logger.info({ tenantId: this.tenantId, modelId: row.id, providerType: row.providerType }, 'Created transcription model');
    return this.toResponse(row);
  }

  async update(id: string, input: UpdateTranscriptionModelInput): Promise<TranscriptionModelResponse | null> {
    const existing = await this.prisma.transcriptionModel.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;

    if (input.isDefault) await this.clearDefault();

    let encryptedCredentials = existing.credentials;
    if (input.credentials && Object.keys(input.credentials).length > 0) {
      encryptedCredentials = this.encryption.encrypt(JSON.stringify(input.credentials));
    }

    const row = await this.prisma.transcriptionModel.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        providerType: input.providerType ?? existing.providerType,
        contract: input.contract ?? existing.contract,
        endpointUrl: input.endpointUrl ?? existing.endpointUrl,
        credentials: encryptedCredentials,
        region: input.region ?? existing.region,
        modelId: input.modelId ?? existing.modelId,
        models: input.models ? ({ models: input.models } as never) : (existing.models ?? undefined),
        config: (input.config ?? existing.config ?? null) as never,
        status: input.status ?? existing.status,
        isDefault: input.isDefault ?? existing.isDefault,
      },
    });
    logger.info({ tenantId: this.tenantId, modelId: id }, 'Updated transcription model');
    return this.toResponse(row);
  }

  async delete(id: string): Promise<{ id: string } | null> {
    const existing = await this.prisma.transcriptionModel.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;
    logger.info({ tenantId: this.tenantId, modelId: id }, 'Deleting transcription model');
    await this.prisma.transcriptionModel.delete({ where: { id } });
    return { id };
  }

  async setDefault(id: string): Promise<TranscriptionModelResponse | null> {
    const existing = await this.prisma.transcriptionModel.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!existing) return null;
    await this.clearDefault();
    const row = await this.prisma.transcriptionModel.update({ where: { id }, data: { isDefault: true } });
    return this.toResponse(row);
  }

  // ─── Discovery (scan / list models) — mirrors LlmProviderService ────────────
  /** Validate an endpoint and list its models without persisting (for the create wizard). */
  async validateAndDiscoverModels(input: ValidateTranscriptionModelInput, discover: TranscriptionDiscoverFn) {
    if (input.providerType === 'CUSTOM') {
      // Custom endpoints have no model list — report reachable, no models to pick.
      return { success: true as const, models: [] as DiscoveredTranscriptionModel[] };
    }
    const models = await discover(input.providerType, (input.credentials ?? {}) as Record<string, string>, input.region);
    return { success: true as const, models };
  }

  private resolveDiscoveryCredentials(providerType: string, credentials: Record<string, string>): Record<string, string> {
    if (providerType !== 'LITELLM') return credentials;
    return {
      baseUrl: credentials.gatewayUrl ?? env.LITELLM_GATEWAY_URL ?? '',
      apiKey: credentials.apiKey ?? credentials.masterKey ?? env.LITELLM_MASTER_KEY ?? '',
    };
  }

  /** Re-scan a saved provider's models and persist the result. */
  async refreshModels(id: string, discover: TranscriptionDiscoverFn): Promise<TranscriptionModelResponse | null> {
    const existing = await this.prisma.transcriptionModel.findFirst({ where: { id, tenantId: this.tenantId } });
    if (!existing) return null;
    if (existing.providerType === 'CUSTOM') return this.toResponse(existing);

    const storedCredentials = existing.credentials
      ? (JSON.parse(this.encryption.decrypt(existing.credentials)) as Record<string, string>)
      : {};
    const credentials = this.resolveDiscoveryCredentials(existing.providerType, storedCredentials);
    const models = await discover(existing.providerType, credentials, existing.region ?? undefined);
    const row = await this.prisma.transcriptionModel.update({
      where: { id },
      data: { models: { models } as never },
    });
    logger.info({ tenantId: this.tenantId, modelId: id, count: models.length }, 'Refreshed transcription models');
    return this.toResponse(row);
  }

  async getConfig(modelId?: string | null, versionId?: string | null): Promise<TranscriptionModelConfig | null> {
    const row = modelId
      ? await this.prisma.transcriptionModel.findFirst({ where: { id: modelId, tenantId: this.tenantId } })
      : await this.prisma.transcriptionModel.findFirst({ where: { tenantId: this.tenantId, isDefault: true } });

    if (!row) {
      logger.info({ tenantId: this.tenantId, modelId: modelId ?? null }, 'No transcription model resolved');
      return null;
    }

    const storedCredentials = row.credentials
      ? (JSON.parse(this.encryption.decrypt(row.credentials)) as Record<string, string>)
      : null;

    let providerType = row.providerType;
    let contract = row.contract;
    let endpointUrl = row.endpointUrl;
    let region = row.region;
    let resolvedModelId = row.modelId;
    const resolvedVersionId = versionId ?? row.activeVersionId ?? null;

    if (resolvedVersionId) {
      const version = await this.prisma.transcriptionModelVersion.findFirst({
        where: { id: resolvedVersionId, modelId: row.id },
      });
      if (version) {
        const cfg = version.config as TranscriptionModelVersionConfigSnapshot | null;
        if (cfg) {
          providerType = cfg.providerType ?? providerType;
          contract = cfg.contract ?? contract;
          endpointUrl = cfg.endpointUrl ?? endpointUrl;
          region = cfg.region ?? region;
          resolvedModelId = cfg.modelId ?? resolvedModelId;
        }
      } else {
        logger.warn({ tenantId: this.tenantId, modelId: row.id, versionId: resolvedVersionId }, 'Requested provider version not found; using live model config');
      }
    }

    const credentials =
      providerType === 'LITELLM'
        ? { apiKey: storedCredentials?.apiKey ?? storedCredentials?.masterKey ?? env.LITELLM_MASTER_KEY ?? '' }
        : storedCredentials;

    return {
      id: row.id,
      providerType,
      contract,
      endpointUrl,
      credentials,
      region,
      modelId: resolvedModelId,
      activeVersionId: row.activeVersionId,
      resolvedVersionId,
    };
  }

  private async clearDefault(): Promise<void> {
    await this.prisma.transcriptionModel.updateMany({
      where: { tenantId: this.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private toResponse(row: {
    id: string;
    tenantId: string;
    name: string;
    providerType: string;
    contract: string;
    endpointUrl: string;
    credentials: string | null;
    region: string | null;
    modelId: string | null;
    models: unknown;
    config: unknown;
    activeVersionId: string | null;
    status: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): TranscriptionModelResponse {
    let credentialsConfigured = false;
    let credentialsHint: string | null = null;

    if (row.credentials) {
      try {
        const decrypted = JSON.parse(this.encryption.decrypt(row.credentials)) as Record<string, string>;
        credentialsConfigured = true;
        const secret = decrypted.apiKey ?? decrypted.token ?? decrypted.authHeaderValue;
        if (secret && secret.length > 6) {
          credentialsHint = `${secret.slice(0, 3)}...${secret.slice(-3)}`;
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
      contract: row.contract,
      endpointUrl: row.endpointUrl,
      region: row.region,
      modelId: row.modelId,
      models: row.models,
      config: row.config,
      activeVersionId: row.activeVersionId,
      status: row.status,
      credentialsConfigured,
      credentialsHint,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
