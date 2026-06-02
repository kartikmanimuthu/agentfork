// libs/ai/src/multimodal-types.ts
import { z } from 'zod';

export const textContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

export const fileContentPartSchema = z.object({
  type: z.literal('file'),
  fileId: z.string().min(1),
});

export const contentPartSchema = z.discriminatedUnion('type', [
  textContentPartSchema,
  fileContentPartSchema,
]);

export const contentPartsMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([
    z.string(),
    z.array(contentPartSchema),
  ]),
});

export type TextContentPart = z.infer<typeof textContentPartSchema>;
export type FileContentPart = z.infer<typeof fileContentPartSchema>;
export type ContentPart = z.infer<typeof contentPartSchema>;
export type ContentPartsMessage = z.infer<typeof contentPartsMessageSchema>;

export interface MessageAttachment {
  fileId: string;
  s3Key: string;
  mimeType: string;
  fileName: string;
  size: number;
}

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_EXTRACTED_TEXT_LENGTH = 50_000;
