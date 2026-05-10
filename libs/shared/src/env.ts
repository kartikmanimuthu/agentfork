import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.string().default("info"),
    SKIP_AUDIT_LOGGING: z.string().optional(),
    AWS_REGION: z.string().min(1).default("ap-south-1"),

    // S3-compatible object storage
    S3_BUCKET: z.string().default("chatbot-knowledge-base-dev"),
    S3_ENDPOINT: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.string().default("false"),

    // NextAuth — optional here so workers can import shared libs without failure
    NEXTAUTH_SECRET: z.string().optional(),
    NEXTAUTH_URL: z.string().url().optional(),

    // Cognito — optional because credentials-based login works without SSO
    COGNITO_APP_CLIENT_ID: z.string().optional(),
    COGNITO_APP_CLIENT_SECRET: z.string().optional(),
    COGNITO_ISSUER: z.string().url().optional(),
    COGNITO_USER_POOL_ID: z.string().optional(),

    // Bedrock
    BEDROCK_CHAT_MODEL: z.string().optional(),
    BEDROCK_EMBEDDING_MODEL: z.string().optional(),

    // App URL (used for reset links, etc.)
    APP_URL: z.string().url().optional(),

    // SES (optional — when set, enables SES email delivery instead of console logging)
    SES_FROM_EMAIL: z.string().email().optional(),

    // Encryption (AES-256-GCM key as 64-character hex string)
    ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
