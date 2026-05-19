import { z } from 'zod';

export const parallelNodeSchema = z.object({
  type: z.literal('parallel'),
  branches: z.array(z.string().min(1)).default([]),
  mergeStrategy: z.enum(['all', 'race', 'any']),
  outputChannel: z.string().min(1, 'Output channel is required'),
});
