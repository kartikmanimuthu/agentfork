import { z } from 'zod';

export const toolNodeSchema = z.object({
  type: z.literal('tool'),
  toolName: z.string().min(1, 'Tool name is required'),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
