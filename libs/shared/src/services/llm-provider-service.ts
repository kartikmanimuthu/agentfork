import { randomUUID } from 'crypto';
import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { EncryptionService } from './encryption-service';
import { createLogger } from '../logging/logger';
import { LiteLLMAdminClient } from './litellm-admin-client';
import { env } from '../env';
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

/**
 * Credential keys that are endpoints rather than secrets, and are therefore
 * returned to the browser in full.
 *
 * The edit form has to render the CURRENT base URL: "change the model or the
 * URL" is impossible if the field comes back blank and the operator has to
 * remember what it used to be. These are addresses, not credentials — an
 * operator who can read the provider row can already see where it points.
 */
const ENDPOINT_CREDENTIAL_KEYS = ['baseUrl', 'gatewayUrl'] as const;

/**
 * Credential keys that never leave the server. Reported by NAME only, so the
 * form can show "Configured — leave blank to keep" without the value ever
 * reaching the browser.
 */
const SECRET_CREDENTIAL_KEYS = ['apiKey', 'secretAccessKey', 'masterKey', 'accessKeyId'] as const;

export type LlmProviderEndpoints = Partial<Record<(typeof ENDPOINT_CREDENTIAL_KEYS)[number], string>>;

export interface LlmProviderResponse {
  id: string;
  tenantId: string;
  name: string;
  providerType: string;
  region: string | null;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  /** Non-secret endpoint values, so the edit form can prefill them. */
  endpoints: LlmProviderEndpoints;
  /**
   * Names of the secrets this provider actually has stored — never their values.
   * A field named here can be left blank on update and `update()`'s merge keeps
   * the existing value.
   */
  configuredSecrets: string[];
  /**
   * The decrypted secrets, present ONLY when explicitly requested via
   * `findById(id, { includeSecrets: true })`.
   *
   * Returning these puts real credentials in the browser, where XSS, extensions
   * and screenshots can reach them, so it is opt-in per call rather than part of
   * the normal response: `list()` never includes them, and the detail endpoint
   * only asks when the edit form needs to prefill the fields. Requested because
   * operators want to see and edit the key they already entered, not merely be
   * told one exists.
   */
  secrets?: Record<string, string>;
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  maxBudgetUsd: number | null;
  models: unknown;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The first chat-capable model in a provider's discovered `models`, used when the
 * provider row itself has no `chatModel` set.
 *
 * `chatModel` is optional on create (`z.string().min(1).optional()`) and the
 * provider form submits `undefined` when the field is blank, so a provider can be
 * saved — and set as the tenant default — with no model named on it. An unpinned
 * Claw has no model of its own to fall back to, so the first chat message threw
 * "createClawModel: chatModel is required on the provider config". The only way
 * through was to pick a model from the chat dropdown, which supplied it as a
 * per-request override; a freshly configured default provider should just work.
 *
 * Embedding models are excluded deliberately: discovery records them in the same
 * list (the Bedrock providers list 18), and defaulting a conversation to
 * `amazon.titan-embed-text-v2:0` would fail every turn. Entries with no
 * capabilities recorded are accepted, because older discovery runs left the field
 * empty and rejecting them would strand those providers.
 */
export function firstChatCapableModel(models: unknown): string | null {
  const list = (models as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return null;
  for (const entry of list as Array<{ id?: unknown; capabilities?: unknown }>) {
    const id = typeof entry?.id === 'string' ? entry.id : null;
    if (!id) continue;
    const caps = entry?.capabilities;
    if (Array.isArray(caps) && !caps.includes('chat')) continue;
    return id;
  }
  return null;
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

  async findById(
    id: string,
    options: { includeSecrets?: boolean } = {},
  ): Promise<LlmProviderResponse | null> {
    const row = await this.prisma.llmProvider.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    if (!row) return null;
    const response = this.toResponse(row);
    if (!options.includeSecrets) return response;

    // Logged every time, because this is the one path that hands real credentials
    // back out of the service. If secrets ever start appearing where they should
    // not, this line is the trail.
    logger.info(
      { tenantId: this.tenantId, providerId: id },
      'Returning decrypted provider credentials for an edit form',
    );
    const stored = this.decryptCredentials(row.credentials, id);
    const secrets: Record<string, string> = {};
    for (const name of SECRET_CREDENTIAL_KEYS) {
      const value = stored[name];
      if (typeof value === 'string' && value) secrets[name] = value;
    }
    return { ...response, secrets };
  }

  async create(input: CreateLlmProviderInput) {
    let credentials = input.credentials;
    let externalKeyAlias: string | null = null;

    if (input.providerType === 'LITELLM') {
      const { gatewayUrl, masterKey } = this.resolveGateway(input.credentials);
      externalKeyAlias = `tenant-${this.tenantId}-${randomUUID()}`;
      const admin = new LiteLLMAdminClient(gatewayUrl, masterKey);
      logger.info({ tenantId: this.tenantId, keyAlias: externalKeyAlias }, 'Provisioning LiteLLM virtual key');
      try {
        const { key } = await admin.generateVirtualKey({
          tenantId: this.tenantId,
          keyAlias: externalKeyAlias,
          maxBudgetUsd: input.maxBudgetUsd,
        });
        credentials = {
          apiKey: key,
          ...(input.credentials?.gatewayUrl ? { gatewayUrl: input.credentials.gatewayUrl } : {}),
          ...(input.credentials?.masterKey ? { masterKey: input.credentials.masterKey } : {}),
        };
      } catch (error) {
        logger.error(
          { tenantId: this.tenantId, keyAlias: externalKeyAlias, error: error instanceof Error ? error.message : error },
          'Failed to provision LiteLLM virtual key'
        );
        throw error;
      }
    }

    if (input.isDefault) await this.clearDefault();

    const encryptedCredentials = credentials
      ? this.encryption.encrypt(JSON.stringify(credentials))
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
        maxBudgetUsd: input.maxBudgetUsd ?? null,
        externalKeyAlias,
        models: input.models ? ({ models: input.models } as any) : null,
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
    if (input.credentials && Object.keys(input.credentials).length > 0) {
      // Merge, never replace. The edit form renders every credential field
      // blank, so it submits only the ones the operator retyped — replacing the
      // blob wholesale silently dropped the rest. Editing an Ollama provider's
      // base URL without re-entering the API key left a credentials blob with
      // no key at all, and the next chat turn failed with 401 while the UI
      // still reported "Credentials: Configured" (toResponse only checks that
      // the blob decrypts, not that a key is in it).
      const stored = this.decryptCredentials(existing.credentials, id);
      // LiteLLM's apiKey is a virtual key this service provisions, so an
      // incoming one is ignored rather than merged.
      const incoming = { ...(input.credentials as Record<string, string>) };
      if (existing.providerType === 'LITELLM') delete incoming.apiKey;
      encryptedCredentials = this.encryption.encrypt(JSON.stringify({ ...stored, ...incoming }));
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
        maxBudgetUsd: input.maxBudgetUsd ?? existing.maxBudgetUsd,
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

    if (existing.providerType === 'LITELLM' && existing.externalKeyAlias) {
      try {
        const stored = existing.credentials
          ? JSON.parse(this.encryption.decrypt(existing.credentials))
          : undefined;
        const { gatewayUrl, masterKey } = this.resolveGateway(stored);
        const admin = new LiteLLMAdminClient(gatewayUrl, masterKey);
        await admin.revokeVirtualKey(existing.externalKeyAlias);
      } catch (error) {
        logger.error(
          { tenantId: this.tenantId, providerId: id, error: error instanceof Error ? error.message : error },
          'Failed to revoke LiteLLM virtual key — proceeding with local deletion'
        );
      }
    }

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

  /**
   * Submitted credentials layered over what the provider already has stored.
   *
   * Same merge direction as `update()`, and for the same reason: the edit form is
   * never given the secrets, so it can only send the fields the operator actually
   * retyped. Validating with just those meant changing a base URL and re-running
   * discovery went out with no API key and failed, which is what made "change the
   * model" look like it required re-entering every credential.
   *
   * Tenant-scoped, so a `providerId` from the browser cannot pull another
   * tenant's credentials. An unknown id degrades to the submitted values rather
   * than throwing — the caller still gets a real validation attempt and a real
   * error if those are insufficient.
   */
  async mergeStoredCredentials(
    providerId: string,
    incoming: Record<string, string>,
  ): Promise<Record<string, string>> {
    try {
      const existing = await this.prisma.llmProvider.findFirst({
        where: { id: providerId, tenantId: this.tenantId },
        select: { id: true, credentials: true },
      });
      if (!existing) {
        logger.warn(
          { tenantId: this.tenantId, providerId },
          'Validation referenced a provider outside this tenant — using submitted credentials only',
        );
        return incoming;
      }
      const stored = this.decryptCredentials(existing.credentials, providerId);
      // Blank strings must not shadow a stored value — an untouched secret field
      // submits '' and would otherwise overwrite the real key with nothing.
      const typed = Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== '' && v != null));
      return { ...stored, ...typed };
    } catch (error) {
      logger.error({ tenantId: this.tenantId, providerId, error }, 'Failed to merge stored credentials for validation');
      throw error;
    }
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

    const storedCredentials = existing.credentials
      ? JSON.parse(this.encryption.decrypt(existing.credentials))
      : {};

    const discoveryCredentials = existing.providerType === 'LITELLM'
      ? { baseUrl: storedCredentials.gatewayUrl ?? env.LITELLM_GATEWAY_URL, apiKey: storedCredentials.apiKey }
      : storedCredentials;

    logger.info(
      { tenantId: this.tenantId, providerId: id, providerType: existing.providerType },
      'Refreshing models for provider'
    );
    const models = await discover(existing.providerType, discoveryCredentials, existing.region ?? undefined);

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
      // Falls back to a discovered chat model rather than leaving this undefined,
      // which made createClawModel throw for any provider saved without one.
      chatModel: row.chatModel ?? firstChatCapableModel(row.models) ?? undefined,
      embeddingModel: row.embeddingModel ?? undefined,
      embeddingDimensions: row.embeddingDimensions ?? undefined,
      baseUrl: row.providerType === 'LITELLM'
        ? (credentials?.gatewayUrl ?? env.LITELLM_GATEWAY_URL)
        : credentials?.baseUrl,
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

  private resolveGateway(credentials?: { gatewayUrl?: string; masterKey?: string }) {
    const gatewayUrl = credentials?.gatewayUrl ?? env.LITELLM_GATEWAY_URL;
    const masterKey = credentials?.masterKey ?? env.LITELLM_MASTER_KEY;
    if (!gatewayUrl || !masterKey) {
      throw new Error('LiteLLM gateway is not configured (provide a gateway URL and admin key, or set LITELLM_GATEWAY_URL / LITELLM_MASTER_KEY)');
    }
    return { gatewayUrl, masterKey };
  }

  private async clearDefault() {
    await this.prisma.llmProvider.updateMany({
      where: { tenantId: this.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  /** Decrypts a stored credentials blob, treating an unreadable one as empty so
   *  an update can re-seed it instead of throwing. */
  private decryptCredentials(credentials: string | null, providerId: string): Record<string, string> {
    if (!credentials) return {};
    try {
      return JSON.parse(this.encryption.decrypt(credentials)) as Record<string, string>;
    } catch (error) {
      logger.warn(
        { tenantId: this.tenantId, providerId, error },
        'Stored LLM provider credentials could not be decrypted — treating as empty for this update',
      );
      return {};
    }
  }

  private toResponse(row: any): LlmProviderResponse {
    let credentialsConfigured = false;
    let credentialsHint: string | null = null;
    // Endpoints, not secrets — safe to return, and the edit form cannot let you
    // change a base URL you are not allowed to see. Anything genuinely secret is
    // reported by NAME only, via `configuredSecrets` below.
    const endpoints: LlmProviderEndpoints = {};
    const configuredSecrets: string[] = [];

    if (row.credentials) {
      try {
        const decrypted = JSON.parse(this.encryption.decrypt(row.credentials));
        credentialsConfigured = true;
        const key = decrypted.apiKey ?? decrypted.accessKeyId;
        if (key && key.length > 6) {
          credentialsHint = `${key.slice(0, 3)}...${key.slice(-3)}`;
        }
        for (const name of ENDPOINT_CREDENTIAL_KEYS) {
          const value = decrypted[name];
          if (typeof value === 'string' && value) endpoints[name] = value;
        }
        // Per-key, unlike `credentialsConfigured`, which only proves the blob
        // decrypted — it reported "Configured" for a provider whose apiKey had
        // been dropped entirely (see the merge comment in `update`). The edit
        // form needs to know WHICH secrets it can safely leave blank, and a
        // single boolean cannot say that.
        for (const name of SECRET_CREDENTIAL_KEYS) {
          if (typeof decrypted[name] === 'string' && decrypted[name]) configuredSecrets.push(name);
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
      endpoints,
      configuredSecrets,
      chatModel: row.chatModel,
      embeddingModel: row.embeddingModel,
      embeddingDimensions: row.embeddingDimensions,
      maxBudgetUsd: row.maxBudgetUsd,
      models: row.models,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
