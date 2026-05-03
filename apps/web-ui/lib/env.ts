import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.string().default("info"),
    SKIP_AUDIT_LOGGING: z.string().optional(),
    AWS_REGION: z.string().min(1).default("ap-south-1"),

    // NextAuth — required for the Next.js app
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url().optional(),

    // Cognito
    COGNITO_APP_CLIENT_ID: z.string().optional(),
    COGNITO_APP_CLIENT_SECRET: z.string().optional(),
    COGNITO_ISSUER: z.string().url().optional(),
    COGNITO_USER_POOL_ID: z.string().optional(),

    // Bedrock
    BEDROCK_CHAT_MODEL: z.string().optional(),
    BEDROCK_EMBEDDING_MODEL: z.string().optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});
