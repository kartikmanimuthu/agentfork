import { MAX_EXTRACTED_TEXT_LENGTH, type MessageAttachment } from './multimodal-types';
import pino from 'pino';

const logger = pino({ name: 'ai:content-resolver' });

type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const ALLOWED_IMAGE_TYPES: Set<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_TEXT_TYPES: Set<string> = new Set(['text/plain', 'text/markdown', 'text/csv']);
const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

export interface FileDownloader {
  downloadAsBuffer(key: string): Promise<Buffer>;
}

export interface StoredMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: MessageAttachment[];
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: ImageMimeType };

export type ResolvedContent = string | ContentPart[];

export interface ResolvedMessage {
  role: 'user' | 'assistant' | 'system';
  content: ResolvedContent;
}

export class ContentResolver {
  constructor(private readonly s3: FileDownloader) {}

  async resolve(
    messages: StoredMessage[],
    currentTurnIndex: number,
  ): Promise<ResolvedMessage[]> {
    const resolved: ResolvedMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isCurrentTurn = i === currentTurnIndex;
      const attachments = msg.attachments ?? [];

      if (attachments.length === 0) {
        resolved.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (!isCurrentTurn) {
        const placeholders = attachments.map((a) => `[Attached: ${a.fileName}]`).join('\n');
        const content = msg.content
          ? `${msg.content}\n\n${placeholders}`
          : placeholders;
        resolved.push({ role: msg.role, content });
        continue;
      }

      const parts: ContentPart[] = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }

      const resolvedParts = await Promise.all(
        attachments.map((attachment) => this.resolveAttachment(attachment)),
      );
      parts.push(...resolvedParts);

      resolved.push({ role: msg.role, content: parts });
    }

    return resolved;
  }

  private async resolveAttachment(attachment: MessageAttachment): Promise<ContentPart> {
    try {
      if (attachment.size > MAX_DOWNLOAD_SIZE) {
        logger.warn({ fileId: attachment.fileId, fileName: attachment.fileName, size: attachment.size }, 'File exceeds max download size');
        return { type: 'text', text: `[File too large: ${attachment.fileName}]` };
      }
      logger.debug(
        { fileId: attachment.fileId, s3Key: attachment.s3Key, mimeType: attachment.mimeType },
        'Resolving attachment',
      );
      const buffer = await this.s3.downloadAsBuffer(attachment.s3Key);
      return await this.processBuffer(buffer, attachment);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        { fileId: attachment.fileId, fileName: attachment.fileName, err: err.message },
        'Failed to resolve attachment',
      );
      return { type: 'text', text: `[File unavailable: ${attachment.fileName}]` };
    }
  }

  private async processBuffer(buffer: Buffer, attachment: MessageAttachment): Promise<ContentPart> {
    const { mimeType, fileName } = attachment;

    if (ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return {
        type: 'image',
        image: buffer.toString('base64'),
        mimeType: mimeType as ImageMimeType,
      };
    }

    if (ALLOWED_TEXT_TYPES.has(mimeType)) {
      const text = buffer.toString('utf-8');
      return { type: 'text', text: this.wrapExtractedText(fileName, text) };
    }

    if (mimeType === 'application/pdf') {
      return await this.extractPdf(buffer, fileName);
    }

    if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return await this.extractWord(buffer, fileName);
    }

    return { type: 'text', text: `[Unsupported file type: ${fileName}]` };
  }

  private async extractPdf(buffer: Buffer, fileName: string): Promise<ContentPart> {
    try {
      const pdfParse = (await import('pdf-parse')) as unknown as {
        default: (buf: Buffer) => Promise<{ text: string }>;
      };
      const result = await pdfParse.default(buffer);
      return { type: 'text', text: this.wrapExtractedText(fileName, result.text) };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ fileName, err: err.message }, 'PDF extraction failed');
      return { type: 'text', text: `[Could not read: ${fileName}]` };
    }
  }

  private async extractWord(buffer: Buffer, fileName: string): Promise<ContentPart> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { type: 'text', text: this.wrapExtractedText(fileName, result.value) };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ fileName, err: err.message }, 'Word extraction failed');
      return { type: 'text', text: `[Could not read: ${fileName}]` };
    }
  }

  private wrapExtractedText(fileName: string, text: string): string {
    const truncated =
      text.length > MAX_EXTRACTED_TEXT_LENGTH
        ? `${text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)}\n\n[Document truncated — showing first ${MAX_EXTRACTED_TEXT_LENGTH} characters]`
        : text;
    return `--- ${fileName} ---\n${truncated}`;
  }
}
