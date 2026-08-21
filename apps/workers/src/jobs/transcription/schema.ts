import { z } from 'zod';

export const transcriptionJobSchema = z.object({
  jobId: z.string(),
  tenantId: z.string(),
  apiKeyId: z.string(),
  jobConfigId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  versionId: z.string().nullable().optional(),
  source: z.enum(['upload', 'payload']),
  stashKey: z.string().nullable().optional(),
  /** The s3Key the Upload API returned to the caller, when source is 'upload'. */
  s3Key: z.string().nullable().optional(),
  /** TranscriptionUpload id — the caller's stable identifier, echoed into the webhook. */
  uploadId: z.string().nullable().optional(),
  /** The caller's own reference, echoed into the webhook verbatim. */
  clientReference: z.string().nullable().optional(),
  mimeType: z.string(),
  fileName: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  diarize: z.boolean().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  webhookSecret: z.string().nullable().optional(),
  /** Set by register.ts from the boss job's own retryCount/retryLimit — whether this is the last allowed attempt. */
  isFinalAttempt: z.boolean().optional(),
  /** Set by register.ts (retryLimit + 1) — total attempts allowed, for the final-attempt error message. */
  totalAttempts: z.number().optional(),
});

export type TranscriptionJobData = z.infer<typeof transcriptionJobSchema>;
