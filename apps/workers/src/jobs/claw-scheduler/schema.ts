import { z } from 'zod';

export const clawSchedulerTickSchema = z.object({
  taskId: z.string().min(1),
  tenantId: z.string().min(1),
  /** Minute-resolution ISO stamp — doubles as the per-run lock key. */
  scheduledAt: z.string().min(1),
});

export type ClawSchedulerTick = z.infer<typeof clawSchedulerTickSchema>;
