import { z } from 'zod';

export const knowledgeBaseNodeSchema = z.object({
  type: z.literal('knowledge_base'),
  knowledgeBaseIds: z.array(z.string()),
  queryChannel: z.string().min(1),
  outputChannel: z.string().min(1),
  topK: z.number().int().positive(),
  threshold: z.number().min(0).max(1).optional(),
});
