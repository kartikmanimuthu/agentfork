import { z } from 'zod';

export const whatsappSendTemplateNodeSchema = z.object({
  type: z.literal('whatsapp_send_template'),
  templateName: z.string().min(1, 'Template name is required'),
  languageCode: z.string().min(2, 'Language code is required'),
  componentsChannel: z.string().optional(),
});
