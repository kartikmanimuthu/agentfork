import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.string().default("info"),
    AWS_REGION: z.string().min(1).default("ap-south-1"),

    DATABASE_URL: z.string().url(),
    WORKER_ARCH: z.enum(["vertical", "horizontal"]).default("vertical"),

    // ECS — only needed for horizontal scaling
    ECS_CLUSTER_ARN: z.string().optional(),
    WORKER_TASK_DEFINITION_ARN: z.string().optional(),
    PRIVATE_SUBNET_IDS: z.string().optional(),
    SECURITY_GROUP_IDS: z.string().optional(),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
