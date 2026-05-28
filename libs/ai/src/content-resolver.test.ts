import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentResolver, type FileDownloader } from './content-resolver';
import type { MessageAttachment } from './multimodal-types';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_EXTRACTED_TEXT_LENGTH } from './multimodal-types';

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ContentResolver', () => {
  describe('resolve — plain text', () => {
    it('returns a TextContentPart for a text/plain attachment', async () => {
      const content = 'Hello, world!';
      const s3 = makeDownloader({ 'uploads/file-1.txt': Buffer.from(content) });
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve([makeAttachment()]);

      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toContain('Hello, world!');
      expect(parts[0].text).toContain('[File: hello.txt]');
    });

    it('truncates text to MAX_EXTRACTED_TEXT_LENGTH', async () => {
      const longText = 'x'.repeat(MAX_EXTRACTED_TEXT_LENGTH + 1000);
      const s3 = makeDownloader({ 'uploads/file-1.txt': Buffer.from(longText) });
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve([makeAttachment()]);

      // The prefix "[File: hello.txt]\n" is prepended before slicing, so the
      // extracted portion is capped at MAX_EXTRACTED_TEXT_LENGTH.
      const extracted = parts[0].text.replace('[File: hello.txt]\n', '');
      expect(extracted.length).toBe(MAX_EXTRACTED_TEXT_LENGTH);
    });
  });

  describe('resolve — attachment cap', () => {
    it(`processes at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`, async () => {
      const attachments = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 2 }, (_, i) =>
        makeAttachment({ fileId: `f${i}`, s3Key: `uploads/f${i}.txt`, fileName: `f${i}.txt` })
      );
      const bufferMap = Object.fromEntries(
        attachments.map((a) => [a.s3Key, Buffer.from(`content of ${a.fileName}`)])
      );
      const s3 = makeDownloader(bufferMap);
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve(attachments);

      expect(parts).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    });
  });

  describe('resolve — error resilience', () => {
    it('skips attachments that fail to download and returns the rest', async () => {
      const good = makeAttachment({ fileId: 'good', s3Key: 'uploads/good.txt', fileName: 'good.txt' });
      const bad = makeAttachment({ fileId: 'bad', s3Key: 'uploads/bad.txt', fileName: 'bad.txt' });

      const s3 = makeDownloader({ 'uploads/good.txt': Buffer.from('good content') });
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve([good, bad]);

      expect(parts).toHaveLength(1);
      expect(parts[0].text).toContain('good content');
    });

    it('skips attachments with unsupported MIME types', async () => {
      const attachment = makeAttachment({ mimeType: 'image/png', fileName: 'photo.png' });
      const s3 = makeDownloader({ 'uploads/file-1.txt': Buffer.from('binary') });
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve([attachment]);

      expect(parts).toHaveLength(0);
    });
  });

  describe('resolve — empty input', () => {
    it('returns an empty array for no attachments', async () => {
      const s3 = makeDownloader({});
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve([]);

      expect(parts).toHaveLength(0);
    });
  });
});
