import { z } from 'zod';

export const ProviderTypeEnum = z.enum([
  'BEDROCK',
  'OPENAI',
  'ANTHROPIC',
  'OLLAMA',
  'VLLM',
  'OPENAI_COMPATIBLE',
  'LITELLM',
]);

export type ProviderType = z.infer<typeof ProviderTypeEnum>;

export const CredentialsSchema = z.object({
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  gatewayUrl: z.string().url().optional(),
  masterKey: z.string().optional(),
});

export const ValidateInputSchema = z.object({
  providerType: ProviderTypeEnum,
  credentials: CredentialsSchema,
  region: z.string().min(1).optional(),
  /**
   * Validate against an EXISTING provider, merging what was submitted over its
   * stored credentials.
   *
   * The edit form cannot send a secret it was never given, so re-discovering
   * models after changing only the base URL used to validate with no API key at
   * all and fail. With this, the server supplies the stored key and the form
   * supplies the new URL. Tenant-scoped on lookup, so an id from the browser
   * cannot reach another tenant's credentials.
   */
  providerId: z.string().min(1).optional(),
});

export const DiscoveredModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
});

export const CreateLlmProviderSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: ProviderTypeEnum,
  region: z.string().min(1).optional(),
  credentials: CredentialsSchema,
  chatModel: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
  models: z.array(DiscoveredModelSchema).optional(),
  isDefault: z.boolean().optional(),
});

export const UpdateLlmProviderSchema = CreateLlmProviderSchema.partial().extend({
  credentials: CredentialsSchema.optional(),
});

export type CreateLlmProviderInput = z.infer<typeof CreateLlmProviderSchema>;
export type UpdateLlmProviderInput = z.infer<typeof UpdateLlmProviderSchema>;
export type ValidateLlmProviderInput = z.infer<typeof ValidateInputSchema>;
