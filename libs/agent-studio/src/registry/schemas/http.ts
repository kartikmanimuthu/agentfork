import { z } from 'zod';

export const httpNodeSchema = z.object({
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().min(1, 'URL is required'),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().optional(),
  bodyChannel: z.string().optional(),
  outputChannel: z.string().min(1, 'Output channel is required'),
  timeoutMs: z.number().int().positive().optional(),
});
