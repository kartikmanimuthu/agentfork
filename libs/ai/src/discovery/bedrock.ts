import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import type { ModelDiscovery, DiscoveredModel } from './types';

export class BedrockModelDiscovery implements ModelDiscovery {
  async discover(credentials: Record<string, string>, region?: string): Promise<DiscoveredModel[]> {
    const effectiveRegion = region ?? 'us-east-1';
    const client = new BedrockClient({
      region: effectiveRegion,
      credentials: credentials.accessKeyId
        ? {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey!,
          }
        : undefined,
    });

    const models: DiscoveredModel[] = [];

    // Prefer inference profiles — these are the IDs that work for on-demand invocation.
    // Raw foundation model IDs (e.g. "anthropic.claude-sonnet-4-6") cannot be invoked
    // directly; Bedrock requires inference profile IDs (e.g. "us.anthropic.claude-sonnet-4-6-v1").
    try {
      const profilesResponse = await client.send(new ListInferenceProfilesCommand({}));
      const profiles = profilesResponse.inferenceProfileSummaries ?? [];

      for (const profile of profiles) {
        if (!profile.inferenceProfileId || !profile.inferenceProfileName) continue;

        const capabilities: DiscoveredModel['capabilities'] = [];
        const id = profile.inferenceProfileId.toLowerCase();

        if (id.includes('embed')) {
          capabilities.push('embedding');
        }
        if (!id.includes('embed')) {
          capabilities.push('chat');
        }

        if (capabilities.length > 0) {
          models.push({
            id: profile.inferenceProfileId,
            name: profile.inferenceProfileName,
            capabilities,
          });
        }
      }

      if (models.length > 0) {
        return models;
      }
    } catch {
      // ListInferenceProfiles may not be available in all regions or with all permissions.
      // Fall back to foundation models.
    }

    // Fallback: use foundation model IDs (older behavior, may not work for newer models)
    const command = new ListFoundationModelsCommand({});
    const response = await client.send(command);

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
