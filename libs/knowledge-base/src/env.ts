import { z } from 'zod';

const kbEnvSchema = z.object({
  AWS_REGION: z.string().default('ap-south-1'),
  OPENAI_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  CRAWLEE_STORAGE_DIR: z.string().optional(),
});

export const kbEnv = kbEnvSchema.parse(process.env);
