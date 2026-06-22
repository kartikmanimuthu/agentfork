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
  config: z.any().optional(),
  showThinking: z.boolean().optional(),
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

const attachmentSchema = z.object({
  fileId: z.string(),
  s3Key: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
  size: z.number(),
});

export const playgroundMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  data: z.object({
    attachments: z.array(attachmentSchema).optional(),
  }).optional(),
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
  attachments: z.array(attachmentSchema).optional(),
});

// ─── MCP Server schemas ───────────────────────────────────────────────────────

export const sseTransportSchema = z.object({
  transport: z.literal('sse'),
  endpoint: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const stdioTransportSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const httpBridgeTransportSchema = z.object({
  transport: z.literal('http_bridge'),
  bridgeUrl: z.string().url(),
  targetCommand: z.string().optional(),
});

export const mcpServerTransportConfigSchema = z.discriminatedUnion('transport', [
  sseTransportSchema,
  stdioTransportSchema,
  httpBridgeTransportSchema,
]);

export const createMcpServerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  transport: z.enum(['sse', 'stdio', 'http_bridge']),
  config: z.object({
    transport: z.enum(['sse', 'stdio', 'http_bridge']),
    transportConfig: mcpServerTransportConfigSchema,
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    retryCount: z.number().int().min(0).max(10).optional(),
  }),
});

export const updateMcpServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  transport: z.enum(['sse', 'stdio', 'http_bridge']).optional(),
  config: z.object({
    transport: z.enum(['sse', 'stdio', 'http_bridge']).optional(),
    transportConfig: mcpServerTransportConfigSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    retryCount: z.number().int().min(0).max(10).optional(),
  }).optional(),
});

// ─── Agent Version schemas ────────────────────────────────────────────────────

export const createAgentVersionSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

// ─── Alias schemas ────────────────────────────────────────────────────────────

export const updateAliasSchema = z.object({
  versionId: z.string().min(1, 'Version ID is required').optional(),
  isDefault: z.boolean().optional(),
});

// ─── Attachment schemas ───────────────────────────────────────────────────────

export const attachKnowledgeBaseSchema = z.object({
  knowledgeBaseId: z.string().min(1, 'Knowledge base ID is required'),
});

export const attachMcpServerSchema = z.object({
  mcpServerId: z.string().min(1, 'MCP server ID is required'),
});

// ─── Playground Session schemas ───────────────────────────────────────────────

export const playgroundSessionMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
});

export const createPlaygroundSessionSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  messages: z.array(playgroundSessionMessageSchema).optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional().nullable(),
  agentVersionId: z.string().optional().nullable(),
});

export const updatePlaygroundSessionSchema = z.object({
  name: z.string().max(200).optional(),
  messages: z.array(playgroundSessionMessageSchema).optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
  agentVersionId: z.string().optional().nullable(),
});

// ─── Graph Validation schema ──────────────────────────────────────────────────

export const graphValidationSchema = z.object({
  graph: z.object({
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
  }),
});

// ─── MCP Server Version schema ────────────────────────────────────────────────

export const createMcpServerVersionSchema = z.object({
  changeNotes: z.string().max(500).optional(),
});

// ─── API Key Rotation schema ──────────────────────────────────────────────────

export const rotateApiKeySchema = z.object({
  gracePeriodHours: z.number().int().min(0).optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type CreateAliasInput = z.infer<typeof createAliasSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type PlaygroundRequestInput = z.infer<typeof playgroundRequestSchema>;
export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
export type CreateAgentVersionInput = z.infer<typeof createAgentVersionSchema>;
export type UpdateAliasInput = z.infer<typeof updateAliasSchema>;
export type AttachKnowledgeBaseInput = z.infer<typeof attachKnowledgeBaseSchema>;
export type AttachMcpServerInput = z.infer<typeof attachMcpServerSchema>;
export type CreatePlaygroundSessionInput = z.infer<typeof createPlaygroundSessionSchema>;
export type UpdatePlaygroundSessionInput = z.infer<typeof updatePlaygroundSessionSchema>;
export type GraphValidationInput = z.infer<typeof graphValidationSchema>;
export type CreateMcpServerVersionInput = z.infer<typeof createMcpServerVersionSchema>;
export type RotateApiKeyInput = z.infer<typeof rotateApiKeySchema>;
