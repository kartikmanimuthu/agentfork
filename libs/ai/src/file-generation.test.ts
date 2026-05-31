import { describe, it, expect, vi } from 'vitest';
import { generateSpreadsheet, generatePdf } from './file-generation';
import type { FileUploader } from './file-generation';

function mockUploader(url = 'https://s3.example.com/file'): FileUploader {
  return {
    upload: vi.fn().mockResolvedValue({ url, key: 'uploads/file' }),
  };
}

describe('generateSpreadsheet', () => {
  it('calls uploader with xlsx buffer and returns __filePart', async () => {
    const uploader = mockUploader('https://s3.example.com/report.xlsx');
    const result = await generateSpreadsheet(
      {
        filename: 'report.xlsx',
        sheets: [{ name: 'Sheet1', rows: [{ col1: 'a', col2: 1 }, { col1: 'b', col2: 2 }] }],
      },
      uploader,
    );

    expect(uploader.upload).toHaveBeenCalledOnce();
    const [buf, name, mime] = (uploader.upload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(name).toBe('report.xlsx');
    expect(mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    expect(result.__filePart).toMatchObject({
      type: 'file',
      name: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      url: 'https://s3.example.com/report.xlsx',
    });
    expect(result.__filePart.sizeBytes).toBeGreaterThan(0);
  });

  it('uses default filename when not provided', async () => {
    const uploader = mockUploader();
    const result = await generateSpreadsheet(
      { sheets: [{ name: 'Data', rows: [{ x: 1 }] }] },
      uploader,
    );
    expect(result.__filePart.name).toBe('report.xlsx');
  });

  it('propagates uploader errors', async () => {
    const uploader: FileUploader = {
      upload: vi.fn().mockRejectedValue(new Error('S3 unavailable')),
    };
    await expect(
      generateSpreadsheet({ sheets: [{ name: 'S', rows: [] }] }, uploader),
    ).rejects.toThrow('S3 unavailable');
  });
});

describe('generatePdf', () => {
  it('calls uploader with pdf buffer and returns __filePart', async () => {
    const uploader = mockUploader('https://s3.example.com/doc.pdf');
    const result = await generatePdf(
      { filename: 'doc.pdf', title: 'My Report', content: 'Line one\nLine two' },
      uploader,
    );

    expect(uploader.upload).toHaveBeenCalledOnce();
    const [buf, name, mime] = (uploader.upload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // Minimal PDF starts with %PDF
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    expect(name).toBe('doc.pdf');
    expect(mime).toBe('application/pdf');

    expect(result.__filePart).toMatchObject({
      type: 'file',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      url: 'https://s3.example.com/doc.pdf',
    });
    expect(result.__filePart.sizeBytes).toBeGreaterThan(0);
  });

  it('uses default filename when not provided', async () => {
    const uploader = mockUploader();
    const result = await generatePdf({ content: 'hello' }, uploader);
    expect(result.__filePart.name).toBe('document.pdf');
  });

  it('propagates uploader errors', async () => {
    const uploader: FileUploader = {
      upload: vi.fn().mockRejectedValue(new Error('network error')),
    };
    await expect(generatePdf({ content: 'x' }, uploader)).rejects.toThrow('network error');
  });
});
