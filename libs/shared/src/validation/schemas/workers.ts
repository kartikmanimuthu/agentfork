import { z } from 'zod';

export const messageEmbeddingJobSchema = z.object({
  messageId: z.string().min(1, 'messageId is required'),
});

export const conversationSummaryJobSchema = z.object({
  conversationId: z.string().min(1, 'conversationId is required'),
  fromMessageIndex: z.number().int().min(0),
});
