import type { ModelDiscovery, DiscoveredModel } from './types';

export class OpenAIModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = credentials.baseUrl ?? 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const models: DiscoveredModel[] = [];

    for (const model of data.data ?? []) {
      const id = model.id as string;
      const capabilities: DiscoveredModel['capabilities'] = [];

      if (id.includes('embedding')) {
        capabilities.push('embedding');
      }
      if (id.includes('gpt') || id.includes('chat')) {
        capabilities.push('chat');
      }

      if (capabilities.length > 0) {
        models.push({
          id,
          name: id,
          capabilities,
        });
      }
    }

    return models;
  }
}
