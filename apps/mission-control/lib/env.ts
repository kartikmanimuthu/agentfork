import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.string().url(),
    // Mission Control's own NextAuth secret (Studio ID + password login).
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url().optional(),
  },
  client: {
    // Mission Control's own public origin. Shown in the connector settings as the
    // webhook URL to register with Slack/Telegram, so in any environment where
    // those platforms must reach us this has to be the externally routable host
    // (a tunnel URL in local development), not localhost.
    NEXT_PUBLIC_MISSION_CONTROL_URL: z.string().url().default('http://localhost:3010/claw-studio/mission-control'),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_MISSION_CONTROL_URL: process.env.NEXT_PUBLIC_MISSION_CONTROL_URL,
  },
  emptyStringAsUndefined: true,
});
