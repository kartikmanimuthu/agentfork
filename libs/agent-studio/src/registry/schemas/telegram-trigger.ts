import { z } from 'zod';

export const telegramTriggerNodeSchema = z.object({
  type: z.literal('telegram_trigger'),
  accountId: z.string().optional(),
  channelMap: z.object({
    chatIdChannel: z.string().optional(),
    textChannel: z.string().optional(),
    messageTypeChannel: z.string().optional(),
    mediaIdChannel: z.string().optional(),
    callbackDataChannel: z.string().optional(),
    fromNameChannel: z.string().optional(),
    isGroupChannel: z.string().optional(),
  }).optional(),
});
