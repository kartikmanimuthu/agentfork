import crypto from 'crypto';
import { createLogger } from '../logging/logger';
import type { CachedResponse } from './response-cache-service';
import { getThresholdBand } from './semantic-cache-thresholds';

const log = createLogger('semantic-cache');

export type { CachedResponse };

export {
  getThresholdBand,
  getPresetThreshold,
  presetForThreshold,
  THRESHOLD_PRESETS,
  WIDEST_THRESHOLD_MIN,
  WIDEST_THRESHOLD_MAX,
} from './semantic-cache-thresholds';
export type { ThresholdBand, ThresholdPreset } from './semantic-cache-thresholds';

export interface ScopeKeyInput {
  agentVersionId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  embeddingModel: string;
}

export function buildScopeKey(input: ScopeKeyInput): string {
  const data = JSON.stringify({
    agentVersionId: input.agentVersionId,
    systemPrompt: input.systemPrompt,
    model: input.model,
    temperature: input.temperature,
    embeddingModel: input.embeddingModel,
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function extractDigits(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

// Ordered, not set-based: "transfer 500 to 200" must not match "transfer 200 to 500".
export function digitsMatch(a: string, b: string): boolean {
  const left = extractDigits(a);
  const right = extractDigits(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

// `n't` is matched as a suffix so isn't/doesn't/won't count without enumerating them.
const NEGATION_PATTERN = /n't\b|\b(?:not|no|never|without|cannot|unable)\b/gi;

export function countNegations(text: string): number {
  return text.match(NEGATION_PATTERN)?.length ?? 0;
}

// Negation flips the meaning while barely moving the embedding: "is the API rate
// limited" and "is the API not rate limited" measure 0.8638 cosine on Titan v2.
export function negationMatch(a: string, b: string): boolean {
  return countNegations(a) === countNegations(b);
}

export interface SemanticCacheDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  llmSemanticCache: {
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface SemanticHit {
  id: string;
  response: CachedResponse;
  promptText: string;
  similarity: number;
}

export interface LookupParams {
  scopeKey: string;
  embedding: number[];
  promptText: string;
  threshold: number;
  embeddingModel: string;
}

export interface StoreParams {
  scopeKey: string;
  tenantId: string;
  agentVersionId: string;
  promptText: string;
  embedding: number[];
  embeddingModel: string;
  response: CachedResponse;
  ttlSeconds: number;
}

interface LookupRow {
  id: string;
  response: CachedResponse;
  prompt_text: string;
  similarity: number;
}

// `config: z.any()` on the agent update schema means an arbitrary value can be
// persisted as the threshold. A non-numeric one inverts the gate (`x < NaN` is
// false), so every comparison must run against a sanitised value.
export function sanitiseThreshold(value: unknown, embeddingModel: string): number {
  const band = getThresholdBand(embeddingModel);
  if (typeof value === 'number' && Number.isFinite(value) && value >= band.min && value <= band.max) {
    return value;
  }
  log.warn(
    { threshold: value, embeddingModel, band, fallback: band.default },
    "Semantic cache threshold is not a number within the embedding model's band — using the default",
  );
  return band.default;
}

export class SemanticCacheService {
  constructor(private readonly db: SemanticCacheDb) {}

  async lookup(params: LookupParams): Promise<SemanticHit | null> {
    try {
      return await this.runLookup(params);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn(
        { scopeKey: params.scopeKey, errorMessage: error.message },
        'Semantic cache lookup failed — treating as a miss',
      );
      return null;
    }
  }

  private async runLookup(params: LookupParams): Promise<SemanticHit | null> {
    if (params.embedding.length === 0) return null;

    const threshold = sanitiseThreshold(params.threshold, params.embeddingModel);
    const vector = `[${params.embedding.join(',')}]`;

    const rows = await this.db.$queryRaw<LookupRow[]>`
      SELECT
        id,
        response,
        "promptText" AS prompt_text,
        1 - (embedding <=> ${vector}::vector) AS similarity
      FROM llm_semantic_cache
      WHERE "scopeKey" = ${params.scopeKey}
        AND "expiresAt" > now()
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vector}::vector
      LIMIT 1
    `;

    const candidate = rows[0];
    if (!candidate) return null;

    const similarity = Number(candidate.similarity);

    // Near-miss logging is the dataset used to decide whether the threshold should move.
    if (similarity < threshold) {
      if (similarity >= threshold - 0.05) {
        log.debug(
          {
            similarity,
            threshold,
            promptText: params.promptText,
            candidatePromptText: candidate.prompt_text,
          },
          'Semantic cache near miss',
        );
      }
      return null;
    }

    if (!digitsMatch(params.promptText, candidate.prompt_text)) {
      log.debug(
        {
          similarity,
          promptText: params.promptText,
          candidatePromptText: candidate.prompt_text,
        },
        'Semantic cache candidate rejected by numeric guard',
      );
      return null;
    }

    if (!negationMatch(params.promptText, candidate.prompt_text)) {
      log.debug(
        {
          similarity,
          promptText: params.promptText,
          candidatePromptText: candidate.prompt_text,
        },
        'Semantic cache candidate rejected by negation guard',
      );
      return null;
    }

    await this.db.llmSemanticCache.update({
      where: { id: candidate.id },
      data: { hitCount: { increment: 1 } },
    });

    return {
      id: candidate.id,
      response: candidate.response,
      promptText: candidate.prompt_text,
      similarity,
    };
  }

  async store(params: StoreParams): Promise<void> {
    if (params.ttlSeconds <= 0) return;
    if (params.embedding.length === 0) return;
    if (!params.response.text || params.response.text.trim().length === 0) return;

    const vector = `[${params.embedding.join(',')}]`;
    const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
    const id = crypto.randomUUID();

    await this.db.$executeRaw`
      INSERT INTO llm_semantic_cache
        (id, "scopeKey", "tenantId", "agentVersionId", "promptText", embedding,
         "embeddingModel", "embeddingDims", response, "hitCount", "expiresAt", "createdAt")
      VALUES
        (${id}, ${params.scopeKey}, ${params.tenantId}, ${params.agentVersionId},
         ${params.promptText}, ${vector}::vector, ${params.embeddingModel},
         ${params.embedding.length}, ${JSON.stringify(params.response)}::jsonb,
         0, ${expiresAt}, now())
    `;
  }

  async cleanupExpired(): Promise<number> {
    const result = (await this.db.llmSemanticCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })) as { count: number };
    return result.count;
  }
}
