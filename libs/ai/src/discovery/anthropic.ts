import type { ModelDiscovery, DiscoveredModel } from './types';

export class AnthropicModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': credentials.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    return (data.data ?? []).map((m: any) => ({
      id: m.id,
      name: m.display_name ?? m.id,
      capabilities: ['chat' as const],
    }));
  }
}
