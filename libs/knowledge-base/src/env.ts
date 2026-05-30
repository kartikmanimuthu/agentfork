import { z } from 'zod';

const kbEnvSchema = z.object({
  AWS_REGION: z.string().default('ap-south-1'),
  OPENAI_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  CRAWLEE_STORAGE_DIR: z.string().optional(),
  // Max parallel headless browsers. Crawlee's autoscaler reads host RAM on
  // Fargate (not the cgroup limit) and over-provisions Chromium, causing OOM
  // segfaults. We crawl seed URLs sequentially, so 1 is the safe default.
  CRAWLEE_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  // Memory budget (MB) Crawlee's snapshotter should assume. Defaults below the
  // 2 GB Fargate task limit to leave headroom for Node/pg-boss/Prisma.
  CRAWLEE_MEMORY_MBYTES: z.coerce.number().int().positive().default(1536),
});

export const kbEnv = kbEnvSchema.parse(process.env);
