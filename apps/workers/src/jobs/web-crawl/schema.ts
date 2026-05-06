import { z } from 'zod';

export const webCrawlJobSchema = z.object({
  dataSourceId: z.string().cuid(),
  tenantId: z.string().cuid(),
  knowledgeBaseId: z.string().cuid(),
});

export type WebCrawlJobData = z.infer<typeof webCrawlJobSchema>;
