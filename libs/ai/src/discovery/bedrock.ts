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

    // Prefer inference profiles for chat — these are the IDs that work for on-demand
    // invocation. Raw foundation model IDs (e.g. "anthropic.claude-sonnet-4-6") cannot be
    // invoked directly; Bedrock requires inference profile IDs (e.g. "us.anthropic.claude-sonnet-4-6-v1").
    try {
      const profilesResponse = await client.send(new ListInferenceProfilesCommand({}));
      const profiles = profilesResponse.inferenceProfileSummaries ?? [];

      for (const profile of profiles) {
        if (!profile.inferenceProfileId || !profile.inferenceProfileName) continue;

        const id = profile.inferenceProfileId.toLowerCase();

        // Skip embedding inference profiles (e.g. "us.cohere.embed-v4:0",
        // "us.twelvelabs.marengo-embed-v2.7"). @ai-sdk/amazon-bedrock's embedding
        // request builder switches on the *foundation* model ID prefix
        // ("cohere.embed-", "amazon.nova-...embed"), which these region-prefixed
        // profile IDs never match, and TwelveLabs has no embedding branch at all —
        // both fail at request time. The matching foundation model IDs below work.
        if (id.includes('embed')) continue;

        models.push({
          id: profile.inferenceProfileId,
          name: profile.inferenceProfileName,
          capabilities: ['chat'],
        });
      }
    } catch {
      // ListInferenceProfiles may not be available in all regions or with all permissions.
      // Fall back to foundation models for chat below.
    }

    const haveChatModels = models.some((model) => model.capabilities.includes('chat'));

    const command = new ListFoundationModelsCommand({});
    const response = await client.send(command);

    for (const model of response.modelSummaries ?? []) {
      if (!model.modelId) continue;
      const id = model.modelId.toLowerCase();

      if (id.includes('embed')) {
        // Only on-demand foundation model IDs work with @ai-sdk/amazon-bedrock's
        // embedding request shapes (Titan/Cohere/Nova prefix checks); provisioned-only
        // variants need a provisioned-throughput ARN, not a bare model ID.
        if (model.inferenceTypesSupported?.includes('ON_DEMAND')) {
          models.push({
            id: model.modelId,
            name: model.modelName ?? model.modelId,
            capabilities: ['embedding'],
          });
        }
        continue;
      }

      if (!haveChatModels) {
        models.push({
          id: model.modelId,
          name: model.modelName ?? model.modelId,
          capabilities: ['chat'],
        });
      }
    }

    return models;
  }
}
