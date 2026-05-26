import { z } from 'zod';

export const conditionNodeSchema = z.object({
  type: z.literal('condition'),
  expression: z.string().min(1, 'Expression is required'),
  trueBranch: z.string().min(1, 'True branch is required'),
  falseBranch: z.string().min(1, 'False branch is required'),
});
