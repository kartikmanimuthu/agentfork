import type { SdkWidgetConfig } from '../types';

export class ConfigService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async fetchConfig(sdkId: string): Promise<SdkWidgetConfig> {
    const res = await fetch(`${this.baseUrl}/api/v1/sdk/${sdkId}/config`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(err.error?.message ?? `Config fetch failed: ${res.status}`);
    }

    return res.json();
  }
}
