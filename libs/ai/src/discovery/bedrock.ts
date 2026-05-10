import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import type { ModelDiscovery, DiscoveredModel } from './types';

export class BedrockModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>, region?: string): Promise<DiscoveredModel[]> {
    const client = new BedrockClient({
      region: region ?? 'us-east-1',
      credentials: credentials.accessKeyId
        ? {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey!,
          }
        : undefined,
    });

    const command = new ListFoundationModelsCommand({});
    const response = await client.send(command);

    const models: DiscoveredModel[] = [];
    for (const model of response.modelSummaries ?? []) {
      if (!model.modelId) continue;
      const capabilities: DiscoveredModel['capabilities'] = [];
      const id = model.modelId.toLowerCase();

      if (id.includes('embed')) {
        capabilities.push('embedding');
      }
      if (!id.includes('embed') || id.includes('multimodal')) {
        capabilities.push('chat');
      }

      if (capabilities.length > 0) {
        models.push({
          id: model.modelId,
          name: model.modelName ?? model.modelId,
          capabilities,
        });
      }
    }

    return models;
  }
}
