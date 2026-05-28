/**
 * ContentResolver — downloads file attachments from S3 and extracts text
 * for inclusion as TextContentParts in LLM messages.
 *
 * Supported MIME types:
 *   application/pdf                                                    → pdf-parse
 *   application/vnd.openxmlformats-officedocument.wordprocessingml.document → mammoth
 *   text/*                                                             → UTF-8 decode
 */

import pino from 'pino';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_EXTRACTED_TEXT_LENGTH,
  type MessageAttachment,
  type TextContentPart,
} from './multimodal-types';

const logger = pino({ name: 'ai:content-resolver' });

/** Minimal S3 surface the resolver depends on — matches S3Service.downloadAsBuffer. */
export interface FileDownloader {
  downloadAsBuffer(key: string): Promise<Buffer>;
}

export class ContentResolver {
  constructor(private readonly s3: FileDownloader) {}

  /**
   * Resolve a list of attachments to TextContentParts.
   * Silently skips attachments that fail to download or parse.
   * Caps at MAX_ATTACHMENTS_PER_MESSAGE and MAX_EXTRACTED_TEXT_LENGTH per file.
   */
  async resolve(attachments: MessageAttachment[]): Promise<TextContentPart[]> {
    const limited = attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    const parts: TextContentPart[] = [];

    for (const attachment of limited) {
      try {
        logger.debug(
          { fileId: attachment.fileId, s3Key: attachment.s3Key, mimeType: attachment.mimeType },
          'Resolving attachment'
        );
        const buffer = await this.s3.downloadAsBuffer(attachment.s3Key);
        const raw = await this.extractText(buffer, attachment.mimeType, attachment.fileName);
        const text = raw.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
        parts.push({
          type: 'text',
          text: `[File: ${attachment.fileName}]\n${text}`,
        });
        logger.info(
          { fileId: attachment.fileId, extractedLength: text.length },
          'Attachment resolved'
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { fileId: attachment.fileId, s3Key: attachment.s3Key, errorMessage: error.message },
          'Failed to resolve attachment — skipping'
        );
      }
    }

    return parts;
  }

  private async extractText(
    buffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<string> {
    if (mimeType === 'application/pdf') {
      // pdf-parse is CJS; the dynamic import resolves to the parse function directly.
      const pdfParse = (await import('pdf-parse')) as unknown as { default: (buf: Buffer) => Promise<{ text: string }> };
      const result = await pdfParse.default(buffer);
      return result.text;
    }

    if (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.toLowerCase().endsWith('.docx')
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (mimeType.startsWith('text/')) {
      return buffer.toString('utf-8');
    }

    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
}
