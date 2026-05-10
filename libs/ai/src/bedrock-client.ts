import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { env } from './env';

let bedrockInstance: ReturnType<typeof createAmazonBedrock> | undefined;

export function getBedrockProvider() {
  if (!bedrockInstance) {
    bedrockInstance = createAmazonBedrock({
      region: env.AWS_REGION,
      credentialProvider: defaultProvider(),
    });
  }
  return bedrockInstance;
}

export const DEFAULT_MODEL = 'anthropic.claude-sonnet-4-20250514-v1:0';
