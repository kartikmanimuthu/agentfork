import type { ModelDiscovery, DiscoveredModel } from './types';

function logDiscovery(message: string, data?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[discovery:openai] ${message}`, data ?? '');
}

export class OpenAIModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>): Promise<DiscoveredModel[]> {
    const baseUrl = (credentials.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${baseUrl}/models`;
    const headers: Record<string, string> = {};
    if (credentials.apiKey) {
      headers.Authorization = `Bearer ${credentials.apiKey}`;
    }

    logDiscovery('Fetching models', { url, hasAuth: !!credentials.apiKey });

    const res = await fetch(url, { headers });

    logDiscovery('Received response', { status: res.status, statusText: res.statusText });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    logDiscovery('Raw response body keys', { keys: Object.keys(data) });

    // OpenAI / vLLM / LM Studio OpenAI-compat return { data: [...] }
    // LM Studio native API returns { models: [...] }
    const rawModels = data.data ?? data.models ?? [];
    logDiscovery('Raw model count', { count: Array.isArray(rawModels) ? rawModels.length : 0 });

    if (Array.isArray(rawModels) && rawModels.length > 0) {
      logDiscovery('First raw model shape', { firstModel: rawModels[0] });
    }

    const models: DiscoveredModel[] = [];

    for (const model of rawModels) {
      // OpenAI uses 'id'. LM Studio native API uses 'path' or 'id'.
      const id = (model.id ?? model.path ?? model.model ?? model.name ?? model.model_name ?? model.title ?? model.alias) as string;
      if (!id) {
        logDiscovery('Skipping model with no identifiable field', { modelKeys: Object.keys(model) });
        continue;
      }

      const capabilities: DiscoveredModel['capabilities'] = [];

      if (id.toLowerCase().includes('embed')) {
        capabilities.push('embedding');
      }
      // Default non-embedding models to chat for OpenAI-compatible endpoints.
      if (capabilities.length === 0) {
        capabilities.push('chat');
      }

      models.push({ id, name: id, capabilities });
    }

    logDiscovery('Parsed models', { count: models.length });
    return models;
  }
}
