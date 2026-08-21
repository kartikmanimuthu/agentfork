import { z } from 'zod';

export const transcriptionWebhookRetrySchema = z.object({
  jobId: z.string(),
  tenantId: z.string(),
  /** Set by register.ts from the boss job's own retryCount/retryLimit — whether this is the last allowed attempt. */
  isFinalAttempt: z.boolean().optional(),
});

export type TranscriptionWebhookRetryData = z.infer<typeof transcriptionWebhookRetrySchema>;
