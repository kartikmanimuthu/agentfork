import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const telegramEnv = createEnv({
  server: {
    TELEGRAM_API_BASE: z.string().url().default('https://api.telegram.org'),
    ENCRYPTION_KEY: z.string().min(1),
    REDIS_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !process.env.ENCRYPTION_KEY,
});
