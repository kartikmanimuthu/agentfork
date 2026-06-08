import { z } from 'zod';

export const telegramSendNodeSchema = z.object({
  type: z.literal('telegram_send'),
  messageChannel: z.string().min(1, 'Message channel is required'),
  parseMode: z.enum(['Markdown', 'HTML']).optional(),
  replyToChannel: z.string().optional(),
});
