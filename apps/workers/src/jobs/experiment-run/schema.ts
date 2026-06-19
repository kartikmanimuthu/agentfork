import { z } from 'zod';

export const experimentRunJobSchema = z.object({
  experimentId: z.string().min(1),
  tenantId: z.string().min(1),
});

export type ExperimentRunJobData = z.infer<typeof experimentRunJobSchema>;
