import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.string().default("info"),
    AWS_REGION: z.string().min(1).default("ap-south-1"),

    DATABASE_URL: z.string().url(),
    WORKER_ARCH: z.enum(["vertical", "horizontal"]).default("vertical"),

    // Origin of Mission Control. The gateway's notification router runs in this
    // process, and builds run links from it for channels that can't render an
    // approval prompt inline.
    MISSION_CONTROL_URL: z.string().url().default("http://localhost:3010/claw-studio/mission-control"),
    /** How often the Claw scheduler sweeper checks which tasks are due. */
    CLAW_SCHEDULER_SWEEP_MS: z.coerce.number().int().positive().default(30_000),

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
