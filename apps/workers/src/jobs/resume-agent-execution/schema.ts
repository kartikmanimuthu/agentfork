import { z } from 'zod';

export const resumeAgentExecutionSchema = z.object({
  pausedExecutionId: z.string().min(1),
  userInput: z.string().min(1),
  tenantId: z.string().min(1),
});
