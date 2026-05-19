import { z } from 'zod';

export const subAgentNodeSchema = z.object({
  type: z.literal('sub_agent'),
  agentId: z.string().min(1, 'Agent ID is required'),
  versionId: z.string().optional(),
  alias: z.string().optional(),
  inputChannel: z.string().min(1, 'Input channel is required'),
  outputChannel: z.string().min(1, 'Output channel is required'),
});
