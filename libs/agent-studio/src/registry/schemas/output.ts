import { z } from 'zod';

export const outputNodeSchema = z.object({
  type: z.literal('output'),
  responseChannel: z.string().min(1, 'Response channel is required'),
  format: z.enum(['text', 'json', 'stream']),
});
