import { z } from 'zod';

export const delayNodeSchema = z.object({
  type: z.literal('delay'),
  delayMs: z.number().int().positive('Delay must be a positive number'),
  delayChannel: z.string().optional(),
});
