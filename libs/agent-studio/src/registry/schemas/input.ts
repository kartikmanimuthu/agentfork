import { z } from 'zod';

const schemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
});

export const inputNodeSchema = z.object({
  type: z.literal('input'),
  mode: z.enum(['messages', 'structured']),
  inputSchema: z.array(schemaFieldSchema).optional(),
});
