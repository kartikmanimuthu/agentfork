import { z } from 'zod';

const schemaFieldSchema = z.object({
  name: z.string().min(1, 'Field name is required'),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
});

export const stateSchemaNodeSchema = z.object({
  type: z.literal('state_schema'),
  fields: z.array(schemaFieldSchema).min(1, 'At least one field is required'),
});
