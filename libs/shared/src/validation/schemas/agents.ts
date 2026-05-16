import { z } from 'zod';

export const agentTypeSchema = z.enum(['simple', 'graph']);

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  type: agentTypeSchema,
  config: z.any(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['draft', 'active', 'inactive']).optional(),
  config: z.any(),
});

export const createAliasSchema = z.object({
  name: z.string().min(1, 'Alias name is required').max(100),
  versionId: z.string().min(1, 'Version is required'),
  isDefault: z.boolean().optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  dailyReqLimit: z.number().int().min(0).optional(),
  dailyTokenLimit: z.number().int().min(0).optional(),
  minuteReqLimit: z.number().int().min(0).optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
});

export const playgroundMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
}).refine((data) => Boolean(data.content || data.parts?.length), {
  message: 'Message content or parts is required',
});

export const playgroundRequestSchema = z.object({
  messages: z.array(playgroundMessageSchema).min(1, 'At least one message is required'),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(100000).optional(),
  agentVersionId: z.string().optional(),
  alias: z.string().optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type CreateAliasInput = z.infer<typeof createAliasSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type PlaygroundRequestInput = z.infer<typeof playgroundRequestSchema>;
