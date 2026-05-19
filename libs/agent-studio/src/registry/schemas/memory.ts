import { z } from 'zod';

export const memoryNodeSchema = z.object({
  type: z.literal('memory'),
  strategy: z.enum(['full', 'sliding_window', 'summary', 'token_limit']),
  maxMessages: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  messagesChannel: z.string().min(1, 'Messages channel is required'),
});
