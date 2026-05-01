import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

let bedrockInstance: ReturnType<typeof createAmazonBedrock> | undefined;

export function getBedrockProvider() {
  if (!bedrockInstance) {
    bedrockInstance = createAmazonBedrock({
      region: process.env.AWS_REGION ?? 'ap-south-1',
    });
  }
  return bedrockInstance;
}

export const DEFAULT_MODEL = 'anthropic.claude-sonnet-4-20250514';
