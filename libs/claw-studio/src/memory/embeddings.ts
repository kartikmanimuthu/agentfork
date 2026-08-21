import { BedrockEmbeddings } from '@langchain/aws';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Embeddings } from '@langchain/core/embeddings';
import { LlmProviderService, createLogger } from '@chatbot/shared';
import { pickEmbeddingProvider } from './pick-embedding-provider';

const logger = createLogger('claw-studio:embeddings');

/** Fixed dimension of the `ClawMemory.embedding` pgvector column. */
export const REQUIRED_EMBEDDING_DIMENSIONS = 1024;

/**
 * Fallback used only when `config.embeddingDimensions` is unset (the DB column allows
 * null). Without this, a `LlmProvider` row with a recognized-but-wrong embedding model
 * and no `embeddingDimensions` set skips the dimension check below entirely — exactly
 * what let a Titan G1 provider (1536-dim output, `embeddingDimensions: null`) through
 * and made every memory write fail at the Postgres insert instead of here, with a clear
 * error. Titan v2/image already get their dimension forced explicitly below regardless
 * of this map; G1 has no dimension-reduction param at all, so this is the only way to
 * catch it before the DB does. An unrecognized model with no stored dimension still
 * can't be validated without calling the API — that gap is unchanged.
 */
export const KNOWN_MODEL_DIMENSIONS: Record<string, number> = {
  'amazon.titan-embed-text-v2:0': REQUIRED_EMBEDDING_DIMENSIONS,
  'amazon.titan-embed-g1-text-02': 1536,
  'amazon.titan-embed-image-v1': REQUIRED_EMBEDDING_DIMENSIONS,
};

export interface ClawEmbeddingsConfig {
  provider: string;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  region?: string;
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class ClawEmbeddingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClawEmbeddingsConfigError';
  }
}

const OPENAI_COMPATIBLE = new Set(['openai', 'openai_compatible', 'ollama', 'vllm', 'litellm', 'lmstudio']);

/**
 * Models that accept a `dimensions` request param and genuinely honour it, so a
 * 1536/3072-native model can be asked for a 1024-dim vector. Titan v2 belongs
 * here because the bedrock branch below already passes `dimensions` for it.
 *
 * Titan G1 is deliberately absent: it has no such parameter and always returns
 * 1536, which is why a stored `embeddingDimensions: 1024` against it must not
 * be believed.
 */
export function supportsDimensionReduction(model: string): boolean {
  return /text-embedding-3/i.test(model) || /titan-embed-text-v2/i.test(model);
}

/**
 * Builds an Embeddings instance from a resolved provider config. Throws
 * ClawEmbeddingsConfigError when the provider cannot produce 1024-dim
 * embeddings (no embedding model, wrong dimensions, unsupported provider, or
 * missing credentials).
 */
export function createClawEmbeddings(config: ClawEmbeddingsConfig): Embeddings {
  if (!config.embeddingModel) {
    throw new ClawEmbeddingsConfigError(
      'createClawEmbeddings: provider has no embedding model configured',
    );
  }

  // Two independent checks, in this order.
  //
  // 1. An explicitly stored dimension that is not 1024 is simply wrong — the
  //    column is vector(1024), so asking for 512 or 1536 can never work.
  if (config.embeddingDimensions && config.embeddingDimensions !== REQUIRED_EMBEDDING_DIMENSIONS) {
    throw new ClawEmbeddingsConfigError(
      `createClawEmbeddings: embeddingDimensions is ${config.embeddingDimensions} but Claw Studio memory requires ${REQUIRED_EMBEDDING_DIMENSIONS}-dim vectors`,
    );
  }

  // 2. A model's NATIVE output size is a fact, and a stored preference must not
  //    override it. Previously the preference won (`config.embeddingDimensions
  //    || KNOWN[...]`), so a provider row claiming 1024 against
  //    `amazon.titan-embed-g1-text-02` — which only emits 1536 and has no
  //    `dimensions` parameter — passed validation, and every memory write then
  //    failed at Postgres with `expected 1024 dimensions, not 1536`. The stored
  //    value is only believed for models that genuinely honour a reduction
  //    request (see supportsDimensionReduction).
  const nativeDimensions = KNOWN_MODEL_DIMENSIONS[config.embeddingModel];
  if (
    nativeDimensions &&
    nativeDimensions !== REQUIRED_EMBEDDING_DIMENSIONS &&
    !supportsDimensionReduction(config.embeddingModel)
  ) {
    throw new ClawEmbeddingsConfigError(
      `createClawEmbeddings: embedding model "${config.embeddingModel}" produces ${nativeDimensions}-dim vectors but Claw Studio memory requires ${REQUIRED_EMBEDDING_DIMENSIONS}-dim vectors, and this model has no dimension-reduction parameter — setting embeddingDimensions does not change what it returns. Use a ${REQUIRED_EMBEDDING_DIMENSIONS}-dim model such as "amazon.titan-embed-text-v2:0".`,
    );
  }

  if (config.provider === 'bedrock') {
    if (!config.region) {
      throw new ClawEmbeddingsConfigError('createClawEmbeddings: Bedrock provider is missing a region');
    }
    // @langchain/aws's BedrockEmbeddings only knows how to shape a request body
    // for Titan-style models (`{inputText}`) or Nova (`{messages}`) — every
    // other model, including Cohere, silently gets the Titan shape regardless.
    // Cohere's actual Bedrock embed API expects `{texts: [...], input_type}`,
    // so a Titan-shaped request to it always fails with Bedrock's own
    // `ValidationException: Malformed request`. Fail fast and clearly here
    // instead of letting every memory-recall call retry against a model this
    // library can't actually talk to and burn the full 20s recall timeout.
    if (/^cohere\./i.test(config.embeddingModel)) {
      throw new ClawEmbeddingsConfigError(
        `createClawEmbeddings: Cohere embedding models ("${config.embeddingModel}") are not supported — @langchain/aws's BedrockEmbeddings only formats requests correctly for Titan/Nova embedding models. Configure the tenant's default LLM provider with a Titan embedding model instead (e.g. "amazon.titan-embed-text-v2:0").`,
      );
    }
    const titanV2 = /titan-embed-text-v2/i.test(config.embeddingModel);
    return new BedrockEmbeddings({
      region: config.region,
      model: config.embeddingModel,
      // Matches model-factory.ts's ChatBedrockConverse: only pass explicit
      // static credentials when both are configured. Otherwise, omit
      // `credentials` entirely so the AWS SDK falls back to its own default
      // provider chain (AWS_PROFILE/SSO, env vars, instance role, etc.) —
      // the same chain that already authenticates the chat model.
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
      ...(titanV2 ? { dimensions: REQUIRED_EMBEDDING_DIMENSIONS } : {}),
    });
  }

  if (config.provider === 'anthropic') {
    throw new ClawEmbeddingsConfigError(
      'createClawEmbeddings: the Anthropic provider does not expose an embeddings API; configure a Bedrock or OpenAI-compatible provider as the tenant default for memory-backed features',
    );
  }

  if (OPENAI_COMPATIBLE.has(config.provider)) {
    return new OpenAIEmbeddings({
      model: config.embeddingModel,
      // Bound the network call so a stalled embeddings request can't hang the
      // whole chat turn (memory recall runs before everything else). Fail fast
      // rather than retry — a stuck endpoint would otherwise multiply the wait.
      timeout: 15_000,
      maxRetries: 1,
      ...(supportsDimensionReduction(config.embeddingModel)
        ? { dimensions: REQUIRED_EMBEDDING_DIMENSIONS }
        : {}),
      configuration: {
        baseURL: config.baseUrl,
        apiKey: config.apiKey ?? 'not-needed',
      },
    });
  }

  throw new ClawEmbeddingsConfigError(`createClawEmbeddings: unsupported provider "${config.provider}"`);
}

const embeddingsCache = new Map<string, Promise<Embeddings>>();

/**
 * Resolves the tenant's EMBEDDING provider and builds its embeddings instance,
 * caching the promise per tenant. A rejected resolution is evicted from the cache
 * so a later call can retry against a fixed provider config.
 *
 * Deliberately NOT the default (chat) provider, which is what this used to read.
 * The two are independent concerns: a tenant can reasonably answer chat from a
 * self-hosted gateway that serves no embedding model at all, and coupling them
 * meant that choice silently disabled long-term memory — recall threw and was
 * swallowed, while save kept writing rows with a NULL `embedding` that the vector
 * search can never return.
 */
export async function getClawEmbeddings(tenantId: string): Promise<Embeddings> {
  const cached = embeddingsCache.get(tenantId);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    try {
      const service = new LlmProviderService(tenantId);
      // list() is already ordered isDefault-first, so a capable default provider
      // is preferred without a special case for it.
      const chosen = pickEmbeddingProvider(await service.list());
      if (!chosen) {
        throw new ClawEmbeddingsConfigError(
          `getClawEmbeddings: no provider for tenant "${tenantId}" can produce ${REQUIRED_EMBEDDING_DIMENSIONS}-dim embeddings — ` +
            `set an embedding model such as "amazon.titan-embed-text-v2:0" on a Bedrock or OpenAI-compatible provider. ` +
            `The chat provider does not need to be the one that embeds.`,
        );
      }
      // Re-read by id to get the decrypted credentials; list() omits them.
      const config = await service.getConfigById(chosen.id);
      if (!config) {
        throw new ClawEmbeddingsConfigError(
          `getClawEmbeddings: provider "${chosen.id}" disappeared while resolving embeddings for tenant "${tenantId}"`,
        );
      }
      logger.info(
        {
          tenantId,
          providerId: chosen.id,
          providerName: chosen.name,
          provider: config.provider,
          embeddingModel: config.embeddingModel,
          // Named so a surprising choice is diagnosable from one log line.
          isChatDefault: chosen.isDefault ?? null,
        },
        'Resolved Claw embeddings provider',
      );
      return createClawEmbeddings(config);
    } catch (error) {
      logger.error(
        { tenantId, error: error instanceof Error ? error.message : error },
        'Failed to resolve Claw embeddings',
      );
      throw error;
    }
  })();

  embeddingsCache.set(tenantId, promise);
  promise.catch(() => {
    embeddingsCache.delete(tenantId);
  });

  return promise;
}
