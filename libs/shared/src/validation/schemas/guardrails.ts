import { z } from 'zod';

const actionSchema = z.enum(['mask', 'block', 'warn']);

const piiRedactionSchema = z.object({
  enabled: z.boolean().default(false),
  patterns: z.array(z.string()).optional(),
  customPatterns: z.array(z.string()).optional(),
});

const secretDetectionSchema = z.object({
  enabled: z.boolean().default(false),
  action: actionSchema.default('mask'),
});

const injectionDetectionSchema = z.object({
  enabled: z.boolean().default(false),
  action: z.enum(['block', 'warn']).default('block'),
  threshold: z.number().min(0).max(1).default(0.5),
});

const topicFenceSchema = z.object({
  allowedSubjects: z.array(z.string()).optional(),
  deniedSubjects: z.array(z.string()).optional(),
  action: z.enum(['block', 'warn']).default('block'),
  mode: z.enum(['keyword', 'judge', 'both']).default('keyword'),
});

const bannedPhrasesSchema = z.object({
  phrases: z.array(z.string()).default([]),
  action: actionSchema.default('mask'),
});

const toxicitySchema = z.object({
  enabled: z.boolean().default(false),
  action: z.enum(['block', 'warn']).default('warn'),
  mode: z.enum(['heuristic', 'judge']).default('judge'),
});

export const guardrailsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  input: z.object({
    piiRedaction: piiRedactionSchema.default({ enabled: false }),
    secretDetection: secretDetectionSchema.default({ enabled: false, action: 'mask' }),
    injectionDetection: injectionDetectionSchema.default({ enabled: false, action: 'block', threshold: 0.5 }),
    topicFence: topicFenceSchema.default({ action: 'block', mode: 'keyword' }),
    bannedPhrases: bannedPhrasesSchema.default({ phrases: [], action: 'mask' }),
    // Zod v4 types `.default()` against the full output shape (inner fields are
    // non-optional in the output because each has its own `.default()`). At
    // runtime an empty object is the correct "all inner guards off" default;
    // the cast satisfies the type checker without changing runtime behavior.
  }).default({} as never),
  output: z.object({
    piiRedaction: piiRedactionSchema.default({ enabled: false }),
    secretDetection: secretDetectionSchema.default({ enabled: false, action: 'mask' }),
    topicFence: topicFenceSchema.default({ action: 'block', mode: 'keyword' }),
    bannedPhrases: bannedPhrasesSchema.default({ phrases: [], action: 'mask' }),
    toxicity: toxicitySchema.default({ enabled: false, action: 'warn', mode: 'judge' }),
  }).default({} as never),
  judge: z.object({
    model: z.string().optional(),
    providerConfigKey: z.string().optional(),
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
  refusalMessage: z.string().default("I'm sorry, I can't help with that request."),
  audit: z.object({
    logBlocks: z.boolean().default(true),
    logFlags: z.boolean().default(false),
  }).default({ logBlocks: true, logFlags: false }),
});

export type GuardrailsConfig = z.infer<typeof guardrailsConfigSchema>;

/**
 * Deep-merge `override` over `base`. For each key, if both `base[key]` and
 * `override[key]` are plain objects (not arrays, not null), recurse; else if
 * `override[key] !== undefined`, take `override[key]`; else keep `base[key]`.
 * Arrays are leaf values (override replaces, no concatenation).
 */
function mergeDeep<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return (override === undefined ? base : (override as T));
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    // base is not an object; fall back to the override (shape already validated).
    return { ...(override as Record<string, unknown>) } as T;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const bVal = (base as Record<string, unknown>)[key];
    const oVal = (override as Record<string, unknown>)[key];
    if (
      oVal !== null &&
      typeof oVal === 'object' &&
      !Array.isArray(oVal) &&
      bVal !== null &&
      typeof bVal === 'object' &&
      !Array.isArray(bVal)
    ) {
      result[key] = mergeDeep(bVal, oVal);
    } else if (oVal !== undefined) {
      result[key] = oVal;
    }
  }
  return result as T;
}

/**
 * Deep-merge a (valid) partial guardrails config over the full default so every
 * nested guard is present. Works around the Zod v4 `.default({} as never)`
 * cascade gap that leaves `input`/`output` empty on a partial parse.
 * Callers must have already validated `partial` with `guardrailsConfigSchema.safeParse`.
 */
export function normalizeGuardrailsConfig(partial: unknown): GuardrailsConfig {
  const base = defaultGuardrailsConfig();
  if (!partial || typeof partial !== 'object') return base;
  return mergeDeep(base, partial) as GuardrailsConfig;
}

export function defaultGuardrailsConfig(): GuardrailsConfig {
  // Pass explicit empty objects for each nested section so Zod parses them and
  // cascades the per-field `.default()` values. Under Zod v4, a parent `.default({})`
  // is returned verbatim without re-parsing, so `parse({})` alone would leave
  // `input`/`output` as empty objects missing their inner defaults.
  return guardrailsConfigSchema.parse({ input: {}, output: {}, judge: {}, audit: {} });
}