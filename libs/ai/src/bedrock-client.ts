import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { env } from './env';

let bedrockInstance: ReturnType<typeof createAmazonBedrock> | undefined;

export function getBedrockProvider() {
  if (!bedrockInstance) {
    bedrockInstance = createAmazonBedrock({
      region: env.AWS_REGION,
    });
  }
  return bedrockInstance;
}

export const DEFAULT_MODEL = 'anthropic.claude-sonnet-4-20250514';
