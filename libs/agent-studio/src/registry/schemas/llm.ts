import { z } from 'zod';

export const llmNodeSchema = z.object({
  type: z.literal('llm'),
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  tools: z.array(z.string()).optional(),
});
