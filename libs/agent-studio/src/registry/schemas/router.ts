import { z } from 'zod';

export const routerNodeSchema = z.object({
  type: z.literal('router'),
  conditions: z
    .array(
      z.object({
        condition: z.string().min(1, 'Condition expression is required'),
        target: z.string().min(1, 'Target node id is required'),
      })
    )
    .min(1, 'At least one condition is required'),
  defaultTarget: z.string().optional(),
});
