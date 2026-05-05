import { z } from 'zod';

export const documentIngestionJobSchema = z.object({
  documentId: z.string().cuid(),
  tenantId: z.string().cuid(),
  s3Key: z.string().min(1),
  mimeType: z.string().min(1),
  knowledgeBaseId: z.string().cuid(),
});

export type DocumentIngestionJobData = z.infer<typeof documentIngestionJobSchema>;
