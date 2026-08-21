import type { SendMessageResponse } from './types';
import { whatsappEnv } from '../env';

export interface NetcoreClientConfig {
  accessToken: string;
  phoneNumberId: string;
}

interface NetcoreSendResponse {
  status: string;
  message: string;
  data: { id: string };
}

interface NetcoreErrorResponse {
  error?: string;
  message: string;
  status: number;
}

export class NetcoreWhatsAppClient {
  private readonly baseUrl = 'https://cpaaswa.netcorecloud.net/api/v2/message';
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(config: NetcoreClientConfig) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
  }

  async sendTextMessage(to: string, text: string): Promise<SendMessageResponse> {
    const response = await this.send('/nc/priority', {
      message: [{
        recipient_whatsapp: to,
        recipient_type: 'individual',
        message_type: 'text',
        source: whatsappEnv.NETCORE_DEFAULT_SOURCE,
        type_text: [{ content: text }],
      }],
    });

    return {
      messaging_product: 'whatsapp',
      contacts: [],
      messages: [{ id: response.data.id }],
    };
  }

  async sendInteractiveMessage(_to: string, _interactive: unknown): Promise<SendMessageResponse> {
    throw new Error('Interactive (menu/button) messages are not yet supported for Netcore accounts');
  }

  private async send(path: string, body: Record<string, unknown>): Promise<NetcoreSendResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as NetcoreErrorResponse;
      throw new Error(error.message ?? `Netcore API error: ${response.status}`);
    }

    return response.json() as Promise<NetcoreSendResponse>;
  }
}
