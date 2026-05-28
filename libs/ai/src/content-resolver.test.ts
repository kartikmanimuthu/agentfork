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

// ── unit tests ────────────────────────────────────────────────────────────────

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

  // ── integration: mixed conversation scenarios ─────────────────────────────

  describe('integration — mixed content-parts conversation', () => {
    it('resolves multiple files in a single turn and preserves order', async () => {
      const s3 = makeDownloader({
        'uploads/a.txt': Buffer.from('Content of A'),
        'uploads/b.txt': Buffer.from('Content of B'),
      });
      const resolver = new ContentResolver(s3);

      const attachments: MessageAttachment[] = [
        makeAttachment({ fileId: 'a', s3Key: 'uploads/a.txt', fileName: 'a.txt' }),
        makeAttachment({ fileId: 'b', s3Key: 'uploads/b.txt', fileName: 'b.txt' }),
      ];

      const parts = await resolver.resolve(attachments);

      expect(parts).toHaveLength(2);
      expect(parts[0].text).toContain('[File: a.txt]');
      expect(parts[0].text).toContain('Content of A');
      expect(parts[1].text).toContain('[File: b.txt]');
      expect(parts[1].text).toContain('Content of B');
    });

    it('handles a mix of successful and failed downloads in one turn', async () => {
      const s3 = makeDownloader({
        'uploads/ok.txt': Buffer.from('OK content'),
        // 'uploads/missing.txt' intentionally absent
      });
      const resolver = new ContentResolver(s3);

      const attachments: MessageAttachment[] = [
        makeAttachment({ fileId: 'ok', s3Key: 'uploads/ok.txt', fileName: 'ok.txt' }),
        makeAttachment({ fileId: 'missing', s3Key: 'uploads/missing.txt', fileName: 'missing.txt' }),
      ];

      const parts = await resolver.resolve(attachments);

      // Only the successful download is returned; the failed one is silently skipped.
      expect(parts).toHaveLength(1);
      expect(parts[0].text).toContain('OK content');
    });

    it('returns empty parts when all attachments fail', async () => {
      const s3 = makeDownloader({});
      const resolver = new ContentResolver(s3);

      const attachments: MessageAttachment[] = [
        makeAttachment({ fileId: 'x', s3Key: 'uploads/x.txt', fileName: 'x.txt' }),
        makeAttachment({ fileId: 'y', s3Key: 'uploads/y.txt', fileName: 'y.txt' }),
      ];

      const parts = await resolver.resolve(attachments);

      expect(parts).toHaveLength(0);
    });
  });

  describe('integration — history placeholder behaviour', () => {
    it('each call to resolve is independent (no shared state between turns)', async () => {
      // Simulates two separate conversation turns each with their own attachment.
      const s3 = makeDownloader({
        'uploads/turn1.txt': Buffer.from('Turn 1 content'),
        'uploads/turn2.txt': Buffer.from('Turn 2 content'),
      });
      const resolver = new ContentResolver(s3);

      const turn1 = await resolver.resolve([
        makeAttachment({ fileId: 't1', s3Key: 'uploads/turn1.txt', fileName: 'turn1.txt' }),
      ]);
      const turn2 = await resolver.resolve([
        makeAttachment({ fileId: 't2', s3Key: 'uploads/turn2.txt', fileName: 'turn2.txt' }),
      ]);

      expect(turn1).toHaveLength(1);
      expect(turn1[0].text).toContain('Turn 1 content');
      expect(turn2).toHaveLength(1);
      expect(turn2[0].text).toContain('Turn 2 content');
      // Ensure turn1 result is not contaminated by turn2
      expect(turn1[0].text).not.toContain('Turn 2 content');
    });

    it('file label prefix acts as a history placeholder for the LLM', async () => {
      // The "[File: name]" prefix is the placeholder that lets the LLM refer back
      // to the file in subsequent turns without re-uploading.
      const s3 = makeDownloader({
        'uploads/report.txt': Buffer.from('Q3 revenue: $1.2M'),
      });
      const resolver = new ContentResolver(s3);

      const parts = await resolver.resolve([
        makeAttachment({ fileId: 'r1', s3Key: 'uploads/report.txt', fileName: 'report.txt' }),
      ]);

      expect(parts[0].text).toMatch(/^\[File: report\.txt\]/);
      expect(parts[0].text).toContain('Q3 revenue: $1.2M');
    });

    it('downloadAsBuffer is called exactly once per attachment per resolve call', async () => {
      const s3 = makeDownloader({
        'uploads/doc.txt': Buffer.from('document content'),
      });
      const resolver = new ContentResolver(s3);

      await resolver.resolve([
        makeAttachment({ fileId: 'd1', s3Key: 'uploads/doc.txt', fileName: 'doc.txt' }),
      ]);

      expect(s3.downloadAsBuffer).toHaveBeenCalledTimes(1);
      expect(s3.downloadAsBuffer).toHaveBeenCalledWith('uploads/doc.txt');
    });
  });
});
