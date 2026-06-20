import { z } from 'zod';

export const evaluatorRunJobSchema = z.object({
  evaluatorId: z.string().min(1),
  tenantId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export type EvaluatorRunJobData = z.infer<typeof evaluatorRunJobSchema>;
