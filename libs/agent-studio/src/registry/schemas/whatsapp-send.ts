import { z } from 'zod';

export const whatsappSendNodeSchema = z.object({
  type: z.literal('whatsapp_send'),
  messageType: z.enum(['text', 'image', 'document', 'audio', 'video']),
  messageChannel: z.string().min(1, 'Message channel is required'),
  mediaIdChannel: z.string().optional(),
  filenameChannel: z.string().optional(),
});
