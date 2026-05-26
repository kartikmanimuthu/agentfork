import { z } from 'zod';

export const routerNodeSchema = z.object({
  type: z.literal('router'),
  mode: z.enum(['expression', 'natural_language']).default('expression'),
  conditions: z
    .array(
      z.object({
        condition: z.string().min(1, 'Condition is required'),
        target: z.string().min(1, 'Target node id is required'),
      })
    )
    .min(1, 'At least one condition is required'),
  defaultTarget: z.string().optional(),
  nlTemperature: z.number().min(0).max(1).default(0).optional(),
  classifierModel: z.string().optional(),
});
