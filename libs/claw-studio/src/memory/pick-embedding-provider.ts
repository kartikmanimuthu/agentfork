import { KNOWN_MODEL_DIMENSIONS, REQUIRED_EMBEDDING_DIMENSIONS, supportsDimensionReduction } from './embeddings';

/**
 * Chooses which of a tenant's providers does memory embeddings — independently of
 * which one answers chat.
 *
 * Memory used to resolve off the tenant's DEFAULT provider, so pointing chat at a
 * self-hosted gateway (which serves no embedding model) silently took long-term
 * memory with it: recall threw and the middleware swallowed it, while save kept
 * writing rows whose `embedding` is NULL — and the recall query is a pure
 * `embedding <=> vector` search, so those rows can never be returned. They are
 * write-only, and 244 of them accumulated before anyone noticed, because the
 * timeline still rendered memory_recall as a 2ms green tick.
 *
 * Caller passes `LlmProviderService.list()` output unchanged: that is already
 * ordered `isDefault desc, createdAt desc`, so honouring input order is what makes
 * "prefer the default provider when it is capable" fall out with no extra rule.
 *
 * "Capable" is stricter than "has an embeddingModel set", and deliberately reuses
 * `embeddings.ts`'s own knowledge rather than forming a second opinion — picking a
 * provider that `createClawEmbeddings` then rejects would trade one clear
 * misconfiguration for a throw on every turn.
 */
export interface EmbeddingCapableProvider {
  id: string;
  name: string;
  providerType: string;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}

/** Providers that can embed at all. Anthropic exposes no embeddings API; Cohere's
 *  wire format is not what @langchain/aws's BedrockEmbeddings produces. */
function providerCanEmbed(providerType: string, embeddingModel: string): boolean {
  if (providerType.toLowerCase() === 'anthropic') return false;
  if (/^cohere\./i.test(embeddingModel)) return false;
  return true;
}

/** Whether this model can actually yield 1024-dim vectors, which the pgvector
 *  column requires. A model with a known non-1024 native size and no dimension
 *  parameter cannot, whatever `embeddingDimensions` claims. */
function canProduceRequiredDimensions(embeddingModel: string, declared: number | null): boolean {
  if (declared !== null && declared !== REQUIRED_EMBEDDING_DIMENSIONS) return false;
  const native = KNOWN_MODEL_DIMENSIONS[embeddingModel];
  if (native === undefined) return true; // unknown model: unverifiable either way, same as createClawEmbeddings
  return native === REQUIRED_EMBEDDING_DIMENSIONS || supportsDimensionReduction(embeddingModel);
}

export function pickEmbeddingProvider<T extends EmbeddingCapableProvider>(providers: T[]): T | null {
  for (const p of providers ?? []) {
    const model = p.embeddingModel?.trim();
    if (!model) continue;
    if (!providerCanEmbed(p.providerType, model)) continue;
    if (!canProduceRequiredDimensions(model, p.embeddingDimensions)) continue;
    return p;
  }
  return null;
}
