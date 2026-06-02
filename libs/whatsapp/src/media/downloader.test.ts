import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaDownloader } from './downloader';

const mockMetaClient = {
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
};

const mockS3Client = {
  upload: vi.fn(),
};

describe('MediaDownloader', () => {
  let downloader: MediaDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new MediaDownloader(mockMetaClient as any, mockS3Client as any, 'test-bucket');
  });

  it('downloads media from Meta and uploads to S3', async () => {
    mockMetaClient.getMediaUrl.mockResolvedValueOnce({
      url: 'https://lookaside.fbsbx.com/media/123',
      mime_type: 'image/jpeg',
      file_size: 2048,
      id: 'media_123',
    });
    mockMetaClient.downloadMedia.mockResolvedValueOnce(new ArrayBuffer(2048));
    mockS3Client.upload.mockResolvedValueOnce('s3://test-bucket/whatsapp/acc_1/media_123.jpg');

    const result = await downloader.download('media_123', 'acc_1');

    expect(result).toEqual({
      s3Key: 'whatsapp/acc_1/media_123.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2048,
    });
    expect(mockMetaClient.getMediaUrl).toHaveBeenCalledWith('media_123');
    expect(mockMetaClient.downloadMedia).toHaveBeenCalledWith('https://lookaside.fbsbx.com/media/123');
  });

  it('derives file extension from mime type', async () => {
    mockMetaClient.getMediaUrl.mockResolvedValueOnce({
      url: 'https://lookaside.fbsbx.com/media/456',
      mime_type: 'application/pdf',
      file_size: 4096,
      id: 'media_456',
    });
    mockMetaClient.downloadMedia.mockResolvedValueOnce(new ArrayBuffer(4096));
    mockS3Client.upload.mockResolvedValueOnce('s3://test-bucket/whatsapp/acc_1/media_456.pdf');

    const result = await downloader.download('media_456', 'acc_1');
    expect(result.s3Key).toBe('whatsapp/acc_1/media_456.pdf');
  });
});
