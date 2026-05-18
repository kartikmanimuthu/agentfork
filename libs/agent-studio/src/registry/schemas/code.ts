import { z } from 'zod';

export const codeNodeSchema = z.object({
  type: z.literal('code'),
  code: z.string().min(1, 'Code is required'),
  language: z.enum(['javascript', 'typescript']),
  inputChannels: z.array(z.string().min(1)).default([]),
  outputChannel: z.string().min(1, 'Output channel is required'),
  timeoutMs: z.number().int().positive().optional(),
});
