import { z } from 'zod';

export const humanNodeSchema = z.object({
  type: z.literal('human'),
  prompt: z.string().min(1, 'Prompt is required'),
  outputChannel: z.string().min(1, 'Output channel is required'),
  timeoutMs: z.number().int().positive().optional(),
});
