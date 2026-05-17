import type { MetaWhatsAppClient } from '../client/meta-api';

export interface S3Uploader {
  upload(bucket: string, key: string, body: Buffer, contentType: string): Promise<string>;
}

export interface DownloadResult {
  s3Key: string;
  mimeType: string;
  fileSize: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'text/plain': 'txt',
};

export class MediaDownloader {
  private readonly metaClient: MetaWhatsAppClient;
  private readonly s3: S3Uploader;
  private readonly bucket: string;

  constructor(metaClient: MetaWhatsAppClient, s3: S3Uploader, bucket: string) {
    this.metaClient = metaClient;
    this.s3 = s3;
    this.bucket = bucket;
  }

  async download(mediaId: string, accountId: string): Promise<DownloadResult> {
    const mediaInfo = await this.metaClient.getMediaUrl(mediaId);
    const data = await this.metaClient.downloadMedia(mediaInfo.url);

    const ext = MIME_TO_EXT[mediaInfo.mime_type] ?? 'bin';
    const s3Key = `whatsapp/${accountId}/${mediaId}.${ext}`;

    await this.s3.upload(this.bucket, s3Key, Buffer.from(data), mediaInfo.mime_type);

    return {
      s3Key,
      mimeType: mediaInfo.mime_type,
      fileSize: mediaInfo.file_size,
    };
  }
}
