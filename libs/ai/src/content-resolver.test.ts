import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentResolver, type FileDownloader, type StoredMessage } from './content-resolver';
import type { MessageAttachment } from './multimodal-types';
import { MAX_EXTRACTED_TEXT_LENGTH } from './multimodal-types';

function makeAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    fileId: 'file-1',
    s3Key: 'uploads/file-1.txt',
    mimeType: 'text/plain',
    fileName: 'hello.txt',
    size: 100,
    ...overrides,
  };
}

function makeDownloader(bufferMap: Record<string, Buffer>): FileDownloader {
  return {
    downloadAsBuffer: vi.fn(async (key: string) => {
      if (key in bufferMap) return bufferMap[key];
      throw new Error(`Key not found: ${key}`);
    }),
  };
}

describe('ContentResolver', () => {
  describe('resolve — text-only messages', () => {
    it('returns text-only messages unchanged', async () => {
      const s3 = makeDownloader({});
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        { role: 'user', content: 'Hello', attachments: [] },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
    });
  });

  describe('resolve — current turn with image attachment', () => {
    it('resolves image attachments as base64 ImagePart', async () => {
      const pngBuffer = Buffer.from('fake-png-data');
      const s3 = makeDownloader({ 'uploads/f1-test.png': pngBuffer });
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        {
          role: 'user',
          content: 'What is this?',
          attachments: [
            makeAttachment({ fileId: 'f1', s3Key: 'uploads/f1-test.png', mimeType: 'image/png', fileName: 'test.png', size: 1024 }),
          ],
        },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result[0].role).toBe('user');
      expect(result[0].content).toEqual([
        { type: 'text', text: 'What is this?' },
        { type: 'image', image: pngBuffer.toString('base64'), mimeType: 'image/png' },
      ]);
      expect(s3.downloadAsBuffer).toHaveBeenCalledWith('uploads/f1-test.png');
    });
  });

  describe('resolve — current turn with text file attachment', () => {
    it('resolves text file attachments as TextPart with filename header', async () => {
      const textBuffer = Buffer.from('Hello from file');
      const s3 = makeDownloader({ 'uploads/f2-readme.txt': textBuffer });
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        {
          role: 'user',
          content: 'Summarize this',
          attachments: [
            makeAttachment({ fileId: 'f2', s3Key: 'uploads/f2-readme.txt', mimeType: 'text/plain', fileName: 'readme.txt', size: 15 }),
          ],
        },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result[0].content).toEqual([
        { type: 'text', text: 'Summarize this' },
        { type: 'text', text: '--- readme.txt ---\nHello from file' },
      ]);
    });
  });

  describe('resolve — history turns with attachments', () => {
    it('replaces attachments with placeholder for history turns', async () => {
      const s3 = makeDownloader({});
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        {
          role: 'user',
          content: 'Check this',
          attachments: [
            makeAttachment({ fileId: 'f1', s3Key: 'uploads/f1-doc.pdf', mimeType: 'application/pdf', fileName: 'doc.pdf', size: 5000 }),
          ],
        },
        { role: 'assistant', content: 'I see a document', attachments: [] },
        { role: 'user', content: 'What about page 2?', attachments: [] },
      ];

      const result = await resolver.resolve(messages, 2);

      expect(result[0].content).toBe('Check this\n\n[Attached: doc.pdf]');
      expect(s3.downloadAsBuffer).not.toHaveBeenCalled();
    });
  });

  describe('resolve — S3 failure fallback', () => {
    it('substitutes placeholder when S3 fetch fails', async () => {
      const s3 = makeDownloader({});
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        {
          role: 'user',
          content: 'Look at this',
          attachments: [
            makeAttachment({ fileId: 'f1', s3Key: 'uploads/f1-img.png', mimeType: 'image/png', fileName: 'img.png', size: 1024 }),
          ],
        },
      ];

      const result = await resolver.resolve(messages, 0);

      expect(result[0].content).toEqual([
        { type: 'text', text: 'Look at this' },
        { type: 'text', text: '[File unavailable: img.png]' },
      ]);
    });
  });

  describe('resolve — text truncation', () => {
    it('truncates extracted text exceeding MAX_EXTRACTED_TEXT_LENGTH with note', async () => {
      const longText = 'x'.repeat(60_000);
      const s3 = makeDownloader({ 'uploads/f1-big.txt': Buffer.from(longText) });
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        {
          role: 'user',
          content: 'Read this',
          attachments: [
            makeAttachment({ fileId: 'f1', s3Key: 'uploads/f1-big.txt', mimeType: 'text/plain', fileName: 'big.txt', size: 60_000 }),
          ],
        },
      ];

      const result = await resolver.resolve(messages, 0);

      const parts = result[0].content as Array<{ type: string; text: string }>;
      const filePart = parts[1];
      expect(filePart.text).toContain('[Document truncated');
      expect(filePart.text).toContain('--- big.txt ---');
    });
  });

  describe('integration — mixed conversation', () => {
    it('handles a mixed conversation with text and image attachments', async () => {
      const s3 = makeDownloader({
        'uploads/img-1-photo.png': Buffer.from('fake-image-bytes'),
      });
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        { role: 'user', content: 'Hello', attachments: [] },
        { role: 'assistant', content: 'Hi! How can I help?', attachments: [] },
        {
          role: 'user',
          content: 'What is in this image?',
          attachments: [
            makeAttachment({
              fileId: 'img-1',
              s3Key: 'uploads/img-1-photo.png',
              mimeType: 'image/png',
              fileName: 'photo.png',
              size: 2048,
            }),
          ],
        },
      ];

      const result = await resolver.resolve(messages, 2);

      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi! How can I help?' });
      expect(result[2].role).toBe('user');
      expect(Array.isArray(result[2].content)).toBe(true);
      const parts = result[2].content as Array<{ type: string }>;
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: 'text', text: 'What is in this image?' });
      expect(parts[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    });

    it('handles history messages with attachments as placeholders', async () => {
      const s3 = makeDownloader({});
      const resolver = new ContentResolver(s3);

      const messages: StoredMessage[] = [
        {
          role: 'user',
          content: 'Check this doc',
          attachments: [
            makeAttachment({
              fileId: 'doc-1',
              s3Key: 'uploads/doc-1-report.pdf',
              mimeType: 'application/pdf',
              fileName: 'report.pdf',
              size: 5000,
            }),
          ],
        },
        { role: 'assistant', content: 'I see a report about Q4 earnings.', attachments: [] },
        { role: 'user', content: 'Summarize page 3', attachments: [] },
      ];

      const result = await resolver.resolve(messages, 2);

      expect(result[0].content).toBe('Check this doc\n\n[Attached: report.pdf]');
      expect(s3.downloadAsBuffer).not.toHaveBeenCalled();
    });
  });
});
