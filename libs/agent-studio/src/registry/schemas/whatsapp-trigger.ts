import { z } from 'zod';

export const whatsappTriggerNodeSchema = z.object({
  type: z.literal('whatsapp_trigger'),
  channelMap: z.object({
    senderIdChannel: z.string().optional(),
    messageTextChannel: z.string().optional(),
    messageTypeChannel: z.string().optional(),
    mediaIdChannel: z.string().optional(),
    withinWindowChannel: z.string().optional(),
  }).optional(),
});
