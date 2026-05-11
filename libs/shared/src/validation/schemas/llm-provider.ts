import { z } from 'zod';

export const ProviderTypeEnum = z.enum([
  'BEDROCK',
  'OPENAI',
  'ANTHROPIC',
  'OLLAMA',
  'VLLM',
  'OPENAI_COMPATIBLE',
]);

export type ProviderType = z.infer<typeof ProviderTypeEnum>;

export const CredentialsSchema = z.object({
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
});

export const ValidateInputSchema = z.object({
  providerType: ProviderTypeEnum,
  credentials: CredentialsSchema,
  region: z.string().min(1).optional(),
});

export const CreateLlmProviderSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: ProviderTypeEnum,
  region: z.string().min(1).optional(),
  credentials: CredentialsSchema,
  chatModel: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
});

export const UpdateLlmProviderSchema = CreateLlmProviderSchema.partial().extend({
  credentials: CredentialsSchema.optional(),
});

export type CreateLlmProviderInput = z.infer<typeof CreateLlmProviderSchema>;
export type UpdateLlmProviderInput = z.infer<typeof UpdateLlmProviderSchema>;
export type ValidateLlmProviderInput = z.infer<typeof ValidateInputSchema>;
