import type {
  SendMessageResponse,
  MediaUrlResponse,
  UploadMediaResponse,
  InteractiveMessage,
  SendTemplateMessageRequest,
  MetaApiError,
} from './types';

export interface MetaClientConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

export class MetaWhatsAppClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(config: MetaClientConfig) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/${config.apiVersion}`;
  }

  async sendTextMessage(to: string, text: string): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async sendImageMessage(to: string, imageId: string, caption?: string): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { id: imageId, caption },
    });
  }

  async sendDocumentMessage(to: string, documentId: string, filename?: string, caption?: string): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: { id: documentId, filename, caption },
    });
  }

  async sendInteractiveMessage(to: string, interactive: InteractiveMessage): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
    });
  }

  async sendTemplateMessage(to: string, templateName: string, languageCode: string, components?: SendTemplateMessageRequest['template']['components']): Promise<SendMessageResponse> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, components },
    });
  }

  async getMediaUrl(mediaId: string): Promise<MediaUrlResponse> {
    const response = await fetch(`${this.baseUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      const error = (await response.json()) as MetaApiError;
      throw new Error(error.error.message);
    }

    return response.json() as Promise<MediaUrlResponse>;
  }

  async downloadMedia(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    return response.arrayBuffer();
  }

  async uploadMedia(file: Buffer, mimeType: string, filename: string): Promise<UploadMediaResponse> {
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', new Blob([file as unknown as ArrayBuffer], { type: mimeType }), filename);
    formData.append('type', mimeType);

    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: formData,
    });

    if (!response.ok) {
      const error = (await response.json()) as MetaApiError;
      throw new Error(error.error.message);
    }

    return response.json() as Promise<UploadMediaResponse>;
  }

  private async sendMessage(body: Record<string, unknown>): Promise<SendMessageResponse> {
    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as MetaApiError;
      throw new Error(error.error.message);
    }

    return response.json() as Promise<SendMessageResponse>;
  }
}
