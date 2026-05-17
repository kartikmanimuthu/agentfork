import { z } from 'zod';

export const mcpServerNodeSchema = z.object({
  type: z.literal('mcp_server'),
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  argumentSource: z.enum(['from_state', 'static']),
  staticArguments: z.record(z.string(), z.unknown()).optional(),
  channelMappings: z.record(z.string(), z.string()).optional(),
  outputChannel: z.string().min(1),
});
