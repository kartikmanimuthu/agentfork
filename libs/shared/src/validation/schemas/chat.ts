import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
  model: z.string().optional(),
  messageCount: z.number().int().min(0).optional(),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().optional(),
  content: z.string().min(1, 'Message cannot be empty').max(10000),
  model: z.string().optional(),
});

export const messageQuerySchema = z.object({
  conversationId: z.string().min(1, 'conversationId is required'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
