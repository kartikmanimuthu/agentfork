import { z } from 'zod';

export const telegramSendButtonsNodeSchema = z.object({
  type: z.literal('telegram_send_buttons'),
  messageChannel: z.string().min(1, 'Message channel is required'),
  buttons: z.array(
    z.array(z.object({
      text: z.string().min(1, 'Button text is required'),
      callbackData: z.string().min(1, 'Callback data is required'),
    }))
  ).default([]),
  buttonsChannel: z.string().optional(),
  parseMode: z.enum(['Markdown', 'HTML']).optional(),
});
