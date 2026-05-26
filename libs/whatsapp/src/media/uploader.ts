import type { MetaWhatsAppClient } from '../client/meta-api';

export interface MediaUploadInput {
  file: Buffer;
  mimeType: string;
  filename: string;
}

export class MediaUploader {
  private readonly client: MetaWhatsAppClient;

  constructor(client: MetaWhatsAppClient) {
    this.client = client;
  }

  async upload(input: MediaUploadInput): Promise<string> {
    const result = await this.client.uploadMedia(input.file, input.mimeType, input.filename);
    return result.id;
  }

  async sendImage(to: string, mediaId: string, caption?: string) {
    return this.client.sendImageMessage(to, mediaId, caption);
  }

  async sendDocument(to: string, mediaId: string, filename?: string, caption?: string) {
    return this.client.sendDocumentMessage(to, mediaId, filename, caption);
  }
}
