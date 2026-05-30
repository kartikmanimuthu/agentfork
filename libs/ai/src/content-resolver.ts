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
    const totalMessages = messages.length;
    const currentTurnAttachments = messages[currentTurnIndex]?.attachments?.length ?? 0;
    const historyAttachments = messages
      .filter((_, i) => i !== currentTurnIndex)
      .reduce((sum, m) => sum + (m.attachments?.length ?? 0), 0);

    logger.info(
      { totalMessages, currentTurnIndex, currentTurnAttachments, historyAttachments },
      'Resolving multimodal messages',
    );

    const startTime = Date.now();
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
        logger.debug(
          { messageIndex: i, attachmentCount: attachments.length, fileNames: attachments.map((a) => a.fileName) },
          'History turn — replaced attachments with placeholders',
        );
        resolved.push({ role: msg.role, content });
        continue;
      }

      const parts: ContentPart[] = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }

      logger.info(
        { messageIndex: i, attachmentCount: attachments.length, fileNames: attachments.map((a) => a.fileName) },
        'Resolving current turn attachments from S3',
      );

      const resolvedParts = await Promise.all(
        attachments.map((attachment) => this.resolveAttachment(attachment)),
      );
      parts.push(...resolvedParts);

      resolved.push({ role: msg.role, content: parts });
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { durationMs, resolvedCount: resolved.length, currentTurnAttachments },
      'Multimodal message resolution complete',
    );

    return resolved;
  }

  private async resolveAttachment(attachment: MessageAttachment): Promise<ContentPart> {
    const { fileId, fileName, s3Key, mimeType, size } = attachment;

    if (size > MAX_DOWNLOAD_SIZE) {
      logger.warn(
        { fileId, fileName, size, maxSize: MAX_DOWNLOAD_SIZE },
        'Attachment exceeds max download size — skipping S3 fetch',
      );
      return { type: 'text', text: `[File too large: ${fileName}]` };
    }

    const startTime = Date.now();
    logger.debug({ fileId, fileName, s3Key, mimeType, size }, 'Downloading attachment from S3');

    try {
      const buffer = await this.s3.downloadAsBuffer(s3Key);
      const downloadMs = Date.now() - startTime;
      logger.info(
        { fileId, fileName, mimeType, sizeBytes: buffer.length, downloadMs },
        'Attachment downloaded from S3',
      );

      const processStart = Date.now();
      const result = await this.processBuffer(buffer, attachment);
      const processMs = Date.now() - processStart;

      logger.info(
        { fileId, fileName, mimeType, resultType: result.type, processMs, totalMs: downloadMs + processMs },
        'Attachment processed successfully',
      );
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startTime;
      logger.error(
        { fileId, fileName, s3Key, mimeType, durationMs, errorMessage: err.message, errorStack: err.stack },
        'Failed to resolve attachment — returning placeholder',
      );
      return { type: 'text', text: `[File unavailable: ${fileName}]` };
    }
  }

  private async processBuffer(buffer: Buffer, attachment: MessageAttachment): Promise<ContentPart> {
    const { mimeType, fileName } = attachment;

    if (ALLOWED_IMAGE_TYPES.has(mimeType)) {
      const base64Length = Math.ceil(buffer.length * 4 / 3);
      logger.debug(
        { fileName, mimeType, rawBytes: buffer.length, base64Length },
        'Encoding image as base64',
      );
      return {
        type: 'image',
        image: buffer.toString('base64'),
        mimeType: mimeType as ImageMimeType,
      };
    }

    if (ALLOWED_TEXT_TYPES.has(mimeType)) {
      const text = buffer.toString('utf-8');
      const truncated = text.length > MAX_EXTRACTED_TEXT_LENGTH;
      logger.debug(
        { fileName, mimeType, originalLength: text.length, truncated, maxLength: MAX_EXTRACTED_TEXT_LENGTH },
        'Processing plain text attachment',
      );
      return { type: 'text', text: this.wrapExtractedText(fileName, text) };
    }

    if (mimeType === 'application/pdf') {
      logger.debug({ fileName, bufferSize: buffer.length }, 'Extracting text from PDF');
      return await this.extractPdf(buffer, fileName);
    }

    if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      logger.debug({ fileName, bufferSize: buffer.length }, 'Extracting text from Word document');
      return await this.extractWord(buffer, fileName);
    }

    logger.warn({ fileName, mimeType }, 'Unsupported MIME type — cannot process attachment');
    return { type: 'text', text: `[Unsupported file type: ${fileName}]` };
  }

  private async extractPdf(buffer: Buffer, fileName: string): Promise<ContentPart> {
    const startTime = Date.now();
    try {
      // Import the internal lib path directly — importing the pdf-parse main entry
      // (v1.1.1) runs a debug test harness that reads a sample PDF from disk and throws.
      // @ts-ignore — pdf-parse has no types for the subpath
      const pdfParse = await import('pdf-parse/lib/pdf-parse.js').then((m) => m.default ?? m);
      const result = await pdfParse(buffer);
      const text = result?.text ?? '';
      const durationMs = Date.now() - startTime;
      const truncated = text.length > MAX_EXTRACTED_TEXT_LENGTH;
      logger.info(
        { fileName, extractedLength: text.length, truncated, durationMs },
        'PDF text extraction complete',
      );
      return { type: 'text', text: this.wrapExtractedText(fileName, text) };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startTime;
      logger.error(
        { fileName, durationMs, errorMessage: err.message, errorStack: err.stack },
        'PDF text extraction failed',
      );
      return { type: 'text', text: `[Could not read: ${fileName}]` };
    }
  }

  private async extractWord(buffer: Buffer, fileName: string): Promise<ContentPart> {
    const startTime = Date.now();
    try {
      // @ts-ignore — match the knowledge-base lib's ESM-interop import pattern
      const mammoth = await import('mammoth').then((m) => m.default ?? m);
      const result = await mammoth.extractRawText({ buffer });
      const text = result?.value ?? '';
      const durationMs = Date.now() - startTime;
      const truncated = text.length > MAX_EXTRACTED_TEXT_LENGTH;
      logger.info(
        { fileName, extractedLength: text.length, truncated, durationMs },
        'Word document text extraction complete',
      );
      return { type: 'text', text: this.wrapExtractedText(fileName, text) };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startTime;
      logger.error(
        { fileName, durationMs, errorMessage: err.message, errorStack: err.stack },
        'Word document text extraction failed',
      );
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
